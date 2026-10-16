/**
 * Provider-agnostic agent loop: the LLM chooses tools, the orchestrator validates and executes them against
 * the user's data, and feeds structured results back until the model produces a final answer.
 */
import { AGENT_TOOLS, executeTool, type AgentTool, type ToolContext } from './tools.ts';
import type { JsonSchema } from './schema.ts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LLMTurn {
  text: string;
  toolCalls: LLMToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  usage?: { inputTokens: number; outputTokens: number };
}

/** A provider-specific, append-only conversation (keeps provider blocks such as thinking intact). */
export interface LLMConversation {
  next(): Promise<LLMTurn>;
  addToolResults(results: { id: string; content: string; isError: boolean }[]): void;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  startConversation(params: { system: string; tools: LLMToolSpec[]; messages: ChatMessage[] }): LLMConversation;
}

/** Why a provider call failed, in provider-neutral terms (drives the user-facing fallback message). */
export type LLMErrorKind = 'quota' | 'rate_limited' | 'auth' | 'timeout' | 'unavailable' | 'bad_request';

/** Thrown by providers for classified failures. Messages must not contain prompts or user data. */
export class LLMProviderError extends Error {
  readonly kind: LLMErrorKind;
  readonly status: number | null;
  constructor(kind: LLMErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'LLMProviderError';
    this.kind = kind;
    this.status = status;
  }
}

export interface ToolRunRecord {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface AgentResult {
  reply: string;
  toolRuns: ToolRunRecord[];
  steps: number;
  status: 'ok' | 'max_steps' | 'refusal' | 'llm_error' | 'deadline';
  /** Set when status is 'llm_error'. */
  errorKind?: LLMErrorKind;
  usage: { inputTokens: number; outputTokens: number };
}

export const SYSTEM_PROMPT = `You are EcoMove AI, a personal mobility-sustainability assistant inside a web and mobile app used mainly in Taiwan.

Your job: answer questions about the user's own transport emissions and help them find realistic lower-carbon options, using the tools provided.

Grounding rules:
- Use tools to get every number you report. Never invent trips, distances, routes, travel times, emission factors or emissions.
- Never compute emissions yourself. Use calculate_trip_emissions, compare_transport_modes, get_route_options or simulate_mobility_scenario, and quote their results.
- Label values clearly as recorded (from saved trips), estimated (calculated for a hypothetical trip), or simulated (scenario).
- When comparing periods, use compare_periods and say whether the comparison is a complete period or the same elapsed portion.
- Describe associations, not causes. Say "emissions were lower while MRT trips increased", not "MRT use caused the reduction".
- State data limitations the tools report: trips needing review, trips with no emission factor, mixed accounting boundaries, short baselines, regional proxy factors.
- If a tool reports that a provider or data is unavailable, say so and offer what is possible instead (for example compare_transport_modes with an estimated distance from the user's history). Do not fill gaps with guesses.
- If the origin or destination needed for route planning is ambiguous or missing, ask one short clarifying question.
- Respect user constraints from get_user_preferences (maximum extra travel time, avoided modes, accessibility notes). Exclude options that break a stated time constraint when travel times are known.

Tone and format:
- Be concise: a short answer first, then at most a few bullet points with the key numbers. Use kg CO2e (or g for small values).
- Be encouraging and practical; never shame the user. Acknowledge that some trips are necessary and that safety, accessibility, cost and time matter.
- Do not claim that the app caused any reduction.
- Do not reveal raw coordinates or internal ids.`;

export function toolSpecs(tools: AgentTool[] = AGENT_TOOLS): LLMToolSpec[] {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

export interface RunAgentOptions {
  provider: LLMProvider;
  ctx: ToolContext;
  /** Prior turns (text only) followed by the new user message as the last element. */
  messages: ChatMessage[];
  /** Volatile context (date, time zone) appended to the latest user message to keep the system prompt cacheable. */
  contextNote?: string;
  maxSteps?: number;
  deadlineMs?: number;
  toolTimeoutMs?: number;
}

export const MAX_HISTORY_MESSAGES = 12;
export const MAX_MESSAGE_CHARS = 4000;

export function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const cleaned = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-MAX_HISTORY_MESSAGES);
  // Conversations must start with a user turn.
  while (cleaned.length && cleaned[0].role !== 'user') cleaned.shift();
  return cleaned;
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? 8;
  const deadline = Date.now() + (opts.deadlineMs ?? 90_000);
  const history = sanitizeHistory(opts.messages);
  if (!history.length || history[history.length - 1].role !== 'user') {
    return { reply: 'Please ask a question.', toolRuns: [], steps: 0, status: 'ok', usage: { inputTokens: 0, outputTokens: 0 } };
  }
  if (opts.contextNote) {
    const last = history[history.length - 1];
    history[history.length - 1] = { ...last, content: `${last.content}\n\n[App context: ${opts.contextNote}]` };
  }

  const conversation = opts.provider.startConversation({ system: SYSTEM_PROMPT, tools: toolSpecs(), messages: history });
  const toolRuns: ToolRunRecord[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let lastText = '';

  for (let step = 1; step <= maxSteps; step++) {
    if (Date.now() > deadline) {
      return { reply: lastText || 'Sorry — this took too long. Please try a more specific question.', toolRuns, steps: step - 1, status: 'deadline', usage };
    }
    let turn: LLMTurn;
    try {
      turn = await conversation.next();
    } catch (e) {
      const errorKind: LLMErrorKind = e instanceof LLMProviderError ? e.kind : 'unavailable';
      return {
        reply:
          errorKind === 'quota' || errorKind === 'rate_limited'
            ? 'The AI assistant has reached its usage limit for now. Your dashboard, Insights and Scenario tools still work without it.'
            : 'The AI assistant is unavailable right now. Your dashboard, Insights and Scenario tools still work without it.',
        toolRuns, steps: step - 1, status: 'llm_error', errorKind, usage,
      };
    }
    usage.inputTokens += turn.usage?.inputTokens ?? 0;
    usage.outputTokens += turn.usage?.outputTokens ?? 0;
    if (turn.text) lastText = turn.text;

    if (turn.stopReason === 'refusal') {
      return { reply: "I can't help with that request. I can answer questions about your trips and transport emissions.", toolRuns, steps: step, status: 'refusal', usage };
    }
    if (!turn.toolCalls.length) {
      return { reply: turn.text || 'I could not produce an answer.', toolRuns, steps: step, status: 'ok', usage };
    }

    const results = await Promise.all(
      turn.toolCalls.map(async (call) => {
        const started = Date.now();
        const exec = await executeTool(call.name, call.input, opts.ctx, opts.toolTimeoutMs);
        toolRuns.push({ name: call.name, ok: exec.ok, durationMs: Date.now() - started, error: exec.ok ? undefined : exec.error });
        return { id: call.id, content: JSON.stringify(exec.output), isError: !exec.ok };
      }),
    );
    conversation.addToolResults(results);
  }
  return {
    reply: lastText || 'I needed more steps than allowed to answer. Please ask a narrower question.',
    toolRuns, steps: maxSteps, status: 'max_steps', usage,
  };
}
