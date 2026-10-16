/**
 * Anthropic implementation of the provider-agnostic `LLMProvider` interface, using the official SDK.
 * Other providers can be added by implementing the same interface (see docs/ARCHITECTURE.md).
 *
 * The conversation is append-only: each assistant response is pushed back verbatim (including any
 * thinking blocks) and all tool results for a turn are returned in a single user message.
 */
import Anthropic from '@anthropic-ai/sdk';
import { LLMProviderError, type ChatMessage, type LLMConversation, type LLMErrorKind, type LLMProvider, type LLMToolSpec, type LLMTurn } from '../core/agent/orchestrator.ts';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  effort?: Effort;
  /** Server-side refusal fallbacks (`fallbacks: "default"`). */
  serverFallbacks?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: Effort;
  private readonly serverFallbacks: boolean;
  private readonly maxTokens: number;

  constructor(opts: AnthropicProviderOptions) {
    this.model = opts.model || DEFAULT_ANTHROPIC_MODEL;
    this.effort = opts.effort ?? 'medium';
    this.serverFallbacks = opts.serverFallbacks ?? true;
    this.maxTokens = opts.maxTokens ?? 16000;
    this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 60_000, maxRetries: 2, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  }

  startConversation(params: { system: string; tools: LLMToolSpec[]; messages: ChatMessage[] }): LLMConversation {
    const messages: Anthropic.Beta.BetaMessageParam[] = params.messages.map((m) => ({ role: m.role, content: m.content }));
    const tools: Anthropic.Beta.BetaTool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }];

    return {
      next: async (): Promise<LLMTurn> => {
        let response: Anthropic.Beta.BetaMessage;
        try {
          response = await this.client.beta.messages.create({
            model: this.model,
            max_tokens: this.maxTokens,
            system,
            tools,
            messages,
            output_config: { effort: this.effort },
            ...(this.serverFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
          } as Anthropic.Beta.MessageCreateParamsNonStreaming);
        } catch (e) {
          const status = e instanceof Anthropic.APIError ? (e.status ?? null) : null;
          const kind: LLMErrorKind =
            e instanceof Anthropic.APIConnectionTimeoutError ? 'timeout'
              : status === 429 ? 'rate_limited'
                : status === 401 || status === 403 ? 'auth'
                  : status === 400 ? 'bad_request'
                    : 'unavailable';
          throw new LLMProviderError(kind, `Anthropic request failed (${status ?? 'network'})`, status);
        }

        if (response.stop_reason === 'refusal') {
          return { text: '', toolCalls: [], stopReason: 'refusal', usage: usageOf(response) };
        }
        messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });

        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        const toolCalls = response.content
          .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, input: b.input }));
        const stopReason: LLMTurn['stopReason'] =
          response.stop_reason === 'tool_use' ? 'tool_use' : response.stop_reason === 'end_turn' ? 'end_turn' : response.stop_reason === 'max_tokens' ? 'max_tokens' : 'other';
        // A truncated response may contain an incomplete tool call; do not execute it.
        return { text, toolCalls: stopReason === 'max_tokens' ? [] : toolCalls, stopReason, usage: usageOf(response) };
      },
      addToolResults: (results) => {
        messages.push({
          role: 'user',
          content: results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, is_error: r.isError })),
        });
      },
    };
  }
}

function usageOf(r: Anthropic.Beta.BetaMessage) {
  return { inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0 };
}

/** Builds the Anthropic provider from environment variables (LLM_PROVIDER=anthropic), or null without a key. */
export function anthropicFromEnv(get: (k: string) => string | undefined): LLMProvider | null {
  const apiKey = get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const effort = get('LLM_EFFORT') as Effort | undefined;
  return new AnthropicProvider({
    apiKey,
    model: get('LLM_MODEL') || DEFAULT_ANTHROPIC_MODEL,
    effort: effort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort) ? effort : 'medium',
    serverFallbacks: (get('LLM_SERVER_FALLBACKS') ?? 'default') !== 'off',
  });
}
