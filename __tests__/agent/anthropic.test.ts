/**
 * @jest-environment node
 */
import { runAgent } from '@core/agent/orchestrator.ts';
import type { AgentDataPort } from '@core/agent/tools.ts';
import { UnavailableRouteProvider } from '@core/routing.ts';
import { DEFAULT_PREFERENCES } from '@core/types.ts';
import { AnthropicProvider } from '../../supabase/functions/_shared/llm/anthropic';
import { providerFromEnv } from '../../supabase/functions/_shared/llm/index';

function message(content: unknown[], stop_reason: string) {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason,
    stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 },
  };
}

const data: AgentDataPort = {
  routeProvider: new UnavailableRouteProvider(),
  now: () => new Date('2026-10-10T04:00:00Z'),
  getPreferences: async () => DEFAULT_PREFERENCES,
  listTrips: async () => [],
};

describe('AnthropicProvider', () => {
  it('sends tools, cached system prompt, effort and server fallbacks; keeps the conversation append-only', async () => {
    const bodies: Record<string, unknown>[] = [];
    const headers: Record<string, string>[] = [];
    const replies = [
      message([{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_user_preferences', input: {} }], 'tool_use'),
      message([{ type: 'text', text: 'Your time zone is Asia/Taipei.' }], 'end_turn'),
    ];
    const fetchMock = jest.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      headers.push(Object.fromEntries(new Headers(init.headers).entries()));
      return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } });
    });
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetch: fetchMock as unknown as typeof fetch });
    const res = await runAgent({ provider, ctx: { data }, messages: [{ role: 'user', content: 'What time zone do you use?' }] });

    expect(res.status).toBe('ok');
    expect(res.reply).toBe('Your time zone is Asia/Taipei.');
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const first = bodies[0] as { model: string; tools: { name: string; input_schema: unknown }[]; system: { cache_control: unknown }[]; output_config: unknown; fallbacks: unknown };
    expect(first.model).toBe('claude-opus-5-5');
    expect(first.tools).toHaveLength(10);
    expect(first.tools[0]).toHaveProperty('input_schema');
    expect(first.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(first.output_config).toEqual({ effort: 'medium' });
    expect(first.fallbacks).toBe('default');
    expect(headers[0]['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(headers[0]['x-api-key']).toBe('sk-test');

    const second = bodies[1] as { messages: { role: string; content: unknown }[] };
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second.messages[1].content).toEqual([
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_user_preferences', input: {} },
    ]);
    const toolResult = (second.messages[2].content as { type: string; tool_use_id: string; is_error: boolean }[])[0];
    expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: false });
  });

  it('maps refusals and does not execute tools from truncated responses', async () => {
    const replies = [message([{ type: 'tool_use', id: 't', name: 'get_user_preferences', input: {} }], 'max_tokens')];
    const fetchMock = jest.fn(async () => new Response(JSON.stringify(replies.shift()), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new AnthropicProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch, serverFallbacks: false });
    const res = await runAgent({ provider, ctx: { data }, messages: [{ role: 'user', content: 'x' }] });
    expect(res.toolRuns).toHaveLength(0);

    const refusal = [message([], 'refusal')];
    const f2 = jest.fn(async () => new Response(JSON.stringify(refusal.shift()), { status: 200, headers: { 'content-type': 'application/json' } }));
    const r2 = await runAgent({ provider: new AnthropicProvider({ apiKey: 'k', fetch: f2 as unknown as typeof fetch }), ctx: { data }, messages: [{ role: 'user', content: 'x' }] });
    expect(r2.status).toBe('refusal');
  });

  it('returns a helpful message when the API fails (no invented answer)', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const res = await runAgent({ provider: new AnthropicProvider({ apiKey: 'bad', fetch: fetchMock as unknown as typeof fetch }), ctx: { data }, messages: [{ role: 'user', content: 'x' }] });
    expect(res.status).toBe('llm_error');
    expect(res.errorKind).toBe('auth');
    expect(res.reply).toMatch(/unavailable/);
  });

  it('is configured only when LLM_PROVIDER=anthropic and an API key is present', () => {
    const anth = (extra: Record<string, string>) => (k: string) => ({ LLM_PROVIDER: 'anthropic', ...extra } as Record<string, string>)[k];
    expect(providerFromEnv(anth({}))).toBeNull();
    const p = providerFromEnv(anth({ ANTHROPIC_API_KEY: 'k', LLM_MODEL: 'claude-sonnet-5-5', LLM_EFFORT: 'low' }));
    expect(p?.name).toBe('anthropic');
    expect(p?.model).toBe('claude-sonnet-5-5');
    expect(providerFromEnv((k: string) => (k === 'LLM_PROVIDER' ? 'unknown' : 'k'))).toBeNull();
  });
});
