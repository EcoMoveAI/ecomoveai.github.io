/**
 * Google Gemini implementation of the provider-agnostic `LLMProvider` interface, using the REST
 * `models.generateContent` endpoint with function calling (no SDK, so it runs unchanged in Deno and Node).
 *
 * - The API key is sent only in the `x-goog-api-key` header from the Edge Function; it never reaches the browser.
 * - The conversation is append-only: each model `content` is pushed back verbatim, which preserves the
 *   `thoughtSignature` parts that Gemini thinking models require when function calling continues.
 * - Tool results go back as `functionResponse` parts in a single user turn.
 * - Failures are classified into `LLMProviderError` kinds (quota, rate limit, auth, timeout, unavailable)
 *   so the app can show an honest fallback. Error messages never include prompts or user data.
 */
import { LLMProviderError, type ChatMessage, type LLMConversation, type LLMErrorKind, type LLMProvider, type LLMToolSpec, type LLMTurn } from '../core/agent/orchestrator.ts';
import type { JsonSchema } from '../core/agent/schema.ts';

/** Default model. Free-tier availability and limits change; override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
/** Tried in order when the primary model is unavailable or out of quota before the conversation starts. */
export const DEFAULT_GEMINI_FALLBACKS = ['gemini-2.5-flash'];
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  fallbackModels?: string[];
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}
interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

const SCHEMA_KEYS = ['type', 'description', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength'] as const;

/**
 * Converts the app's JSON-Schema subset to Gemini's OpenAPI-style `Schema`. Keywords Gemini does not accept
 * (`additionalProperties`, `pattern`) are dropped here; the orchestrator still enforces the full schema
 * server-side before any tool runs, so dropping them never weakens validation.
 */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const src = schema as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of SCHEMA_KEYS) if (src[k] !== undefined) out[k] = src[k];
  if (schema.type === 'object') {
    const props = Object.entries(schema.properties);
    if (props.length) out.properties = Object.fromEntries(props.map(([k, v]) => [k, toGeminiSchema(v)]));
    if (schema.required?.length) out.required = schema.required;
  }
  if (schema.type === 'array') out.items = toGeminiSchema(schema.items);
  return out;
}

export function toFunctionDeclarations(tools: LLMToolSpec[]) {
  return tools.map((t) => {
    const hasParams = t.inputSchema.type === 'object' && Object.keys(t.inputSchema.properties).length > 0;
    // Gemini rejects OBJECT parameters with no properties, so parameterless tools omit `parameters`.
    return { name: t.name, description: t.description, ...(hasParams ? { parameters: toGeminiSchema(t.inputSchema) } : {}) };
  });
}

/** Maps an HTTP failure to a provider-neutral kind. The body is inspected only for Google's error codes. */
export function classifyGeminiError(status: number, body: string): LLMErrorKind {
  if (status === 429) return /PerDay|per day|daily/i.test(body) ? 'quota' : /quota/i.test(body) && !/PerMinute|per minute/i.test(body) ? 'quota' : 'rate_limited';
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(body)) return 'auth';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 400) return 'bad_request';
  return 'unavailable';
}

const REFUSAL_REASONS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);

function parseArgs(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { result: parsed };
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  model: string;
  private readonly apiKey: string;
  private readonly fallbacks: string[];
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(opts: GeminiProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || DEFAULT_GEMINI_MODEL;
    this.fallbacks = (opts.fallbackModels ?? DEFAULT_GEMINI_FALLBACKS).filter((m) => m && m !== this.model);
    this.maxOutputTokens = opts.maxOutputTokens ?? 8192;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.fetchImpl = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? API_BASE;
  }

  private async call(model: string, body: unknown): Promise<GeminiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new LLMProviderError(aborted ? 'timeout' : 'unavailable', aborted ? 'Gemini request timed out' : 'Gemini request failed (network)');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LLMProviderError(classifyGeminiError(res.status, text), `Gemini HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as GeminiResponse;
  }

  /** One retry for transient server errors, then (only before the conversation has started) the fallback models. */
  private async generate(body: unknown, allowModelFallback: boolean): Promise<GeminiResponse> {
    const models = allowModelFallback ? [this.model, ...this.fallbacks] : [this.model];
    let lastError: unknown = null;
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await this.call(model, body);
          this.model = model; // stick with the model that answered (thought signatures are model-specific)
          return r;
        } catch (e) {
          lastError = e;
          if (!(e instanceof LLMProviderError)) throw e;
          const transient = e.kind === 'unavailable' && (e.status == null || e.status >= 500);
          if (transient && attempt === 0) {
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }
          const tryNextModel = e.kind === 'quota' || e.kind === 'rate_limited' || e.kind === 'unavailable' || e.status === 404;
          if (!tryNextModel) throw e;
          break;
        }
      }
    }
    throw lastError;
  }

  startConversation(params: { system: string; tools: LLMToolSpec[]; messages: ChatMessage[] }): LLMConversation {
    const contents: GeminiContent[] = params.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const functionDeclarations = toFunctionDeclarations(params.tools);
    const callNames = new Map<string, string>();
    const syntheticIds = new Set<string>();
    let started = false;

    return {
      next: async (): Promise<LLMTurn> => {
        const body = {
          systemInstruction: { parts: [{ text: params.system }] },
          contents,
          tools: [{ functionDeclarations }],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: { maxOutputTokens: this.maxOutputTokens },
        };
        let response = await this.generate(body, !started);
        let candidate = response.candidates?.[0];
        // A malformed function call is retried once; the model usually corrects itself.
        if (candidate?.finishReason === 'MALFORMED_FUNCTION_CALL') {
          response = await this.generate(body, false);
          candidate = response.candidates?.[0];
        }
        started = true;
        const usage = {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
        };
        if (!candidate) {
          return { text: '', toolCalls: [], stopReason: response.promptFeedback?.blockReason ? 'refusal' : 'other', usage };
        }
        const reason = candidate.finishReason ?? 'STOP';
        if (REFUSAL_REASONS.has(reason)) return { text: '', toolCalls: [], stopReason: 'refusal', usage };

        const parts = candidate.content?.parts ?? [];
        if (parts.length) contents.push({ role: 'model', parts });
        const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
        const toolCalls = parts
          .filter((p) => p.functionCall)
          .map((p, i) => {
            const fc = p.functionCall!;
            const id = fc.id ?? `call_${contents.length}_${i}`;
            callNames.set(id, fc.name);
            if (!fc.id) syntheticIds.add(id);
            return { id, name: fc.name, input: fc.args ?? {} };
          });
        const stopReason: LLMTurn['stopReason'] = reason === 'MAX_TOKENS' ? 'max_tokens' : toolCalls.length ? 'tool_use' : reason === 'STOP' ? 'end_turn' : 'other';
        // A truncated response may contain an incomplete tool call; do not execute it.
        return { text, toolCalls: stopReason === 'max_tokens' ? [] : toolCalls, stopReason, usage };
      },
      addToolResults: (results) => {
        contents.push({
          role: 'user',
          parts: results.map((r) => {
            const name = callNames.get(r.id) ?? 'unknown_tool';
            const payload = parseArgs(r.content);
            return {
              functionResponse: {
                // Echo the id only when Gemini supplied one (older models match responses by name and order).
                ...(syntheticIds.has(r.id) ? {} : { id: r.id }),
                name,
                response: r.isError ? { error: payload } : payload,
              },
            };
          }),
        });
      },
    };
  }
}

export function geminiFromEnv(get: (k: string) => string | undefined): GeminiProvider | null {
  const apiKey = get('GEMINI_API_KEY');
  if (!apiKey) return null;
  const fallbacks = get('GEMINI_FALLBACK_MODELS');
  return new GeminiProvider({
    apiKey,
    model: get('GEMINI_MODEL') || get('LLM_MODEL') || DEFAULT_GEMINI_MODEL,
    fallbackModels: fallbacks == null ? DEFAULT_GEMINI_FALLBACKS : fallbacks.split(',').map((s) => s.trim()).filter(Boolean),
  });
}
