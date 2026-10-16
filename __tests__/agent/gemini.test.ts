/**
 * @jest-environment node
 *
 * Gemini provider against a mocked REST API (no network, no key). Live calls are not part of the suite;
 * see docs/TESTING.md for the manual smoke test with a real GEMINI_API_KEY.
 */
import { runAgent, toolSpecs } from '@core/agent/orchestrator.ts';
import type { AgentDataPort } from '@core/agent/tools.ts';
import { UnavailableRouteProvider } from '@core/routing.ts';
import { DEFAULT_PREFERENCES } from '@core/types.ts';
import { classifyGeminiError, GeminiProvider, geminiFromEnv, toFunctionDeclarations } from '../../supabase/functions/_shared/llm/gemini';
import { providerFromEnv } from '../../supabase/functions/_shared/llm/index';
import { makeTrip } from '../helpers';

const data: AgentDataPort = {
  routeProvider: new UnavailableRouteProvider(),
  now: () => new Date('2026-10-10T04:00:00Z'),
  getPreferences: async () => DEFAULT_PREFERENCES,
  listTrips: async () => [makeTrip('2026-10-09T01:00:00Z', 'taxi', 6)],
};

type Part = Record<string, unknown>;
const reply = (parts: Part[], finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts }, finishReason }],
  usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockFetch(responses: (Response | ((url: string, init: RequestInit) => Promise<Response>))[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fn = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error('unexpected call');
    return typeof next === 'function' ? next(url, init) : next;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const ask = (provider: GeminiProvider, q = 'Why was my footprint higher this month?') => runAgent({ provider, ctx: { data }, messages: [{ role: 'user', content: q }] });

describe('GeminiProvider', () => {
  it('declares the 10 tools, runs a function-call round trip and keeps thought signatures', async () => {
    const m = mockFetch([
      ok(reply([{ text: 'Checking.', thoughtSignature: 'sig-abc' }, { functionCall: { id: 'fc1', name: 'get_user_preferences', args: {} } }])),
      ok(reply([{ text: 'Your time zone is Asia/Taipei.' }])),
    ]);
    const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-test', fetch: m.fn });
    const res = await ask(provider, 'Which time zone do you use?');

    expect(res.status).toBe('ok');
    expect(res.reply).toBe('Your time zone is Asia/Taipei.');
    expect(res.toolRuns).toEqual([expect.objectContaining({ name: 'get_user_preferences', ok: true })]);
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 30 });

    const first = m.calls[0];
    expect(first.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(first.headers['x-goog-api-key']).toBe('test-key');
    expect(first.url).not.toContain('test-key'); // key only in the header, never in the URL
    const decls = (first.body.tools as { functionDeclarations: { name: string }[] }[])[0].functionDeclarations;
    expect(decls.map((d) => d.name).sort()).toEqual([
      'calculate_trip_emissions', 'compare_periods', 'compare_transport_modes', 'generate_sustainability_insight', 'get_emission_factors',
      'get_emissions_summary', 'get_route_options', 'get_trip_history', 'get_user_preferences', 'simulate_mobility_scenario',
    ]);
    expect(JSON.stringify(first.body.tools)).not.toMatch(/additionalProperties|"pattern"/);
    expect((first.body.systemInstruction as { parts: { text: string }[] }).parts[0].text).toMatch(/Never compute emissions yourself/);

    // Second request: the model turn is echoed verbatim (incl. thoughtSignature) and the tool result follows.
    const contents = m.calls[1].body.contents as { role: string; parts: Part[] }[];
    expect(contents[1]).toEqual({ role: 'model', parts: [{ text: 'Checking.', thoughtSignature: 'sig-abc' }, { functionCall: { id: 'fc1', name: 'get_user_preferences', args: {} } }] });
    const fr = (contents[2].parts[0] as { functionResponse: { id: string; name: string; response: Record<string, unknown> } }).functionResponse;
    expect(contents[2].role).toBe('user');
    expect(fr.id).toBe('fc1');
    expect(fr.name).toBe('get_user_preferences');
    expect(fr.response).toMatchObject({ time_zone: 'Asia/Taipei' });
  });

  it('rejects invalid model-generated tool arguments before execution and reports the error to the model', async () => {
    const m = mockFetch([
      ok(reply([{ functionCall: { name: 'calculate_trip_emissions', args: { distance_km: -5, mode: 'rocket' } } }])),
      ok(reply([{ text: 'I need a valid distance and mode.' }])),
    ]);
    const res = await ask(new GeminiProvider({ apiKey: 'k', fetch: m.fn }));
    expect(res.toolRuns[0]).toMatchObject({ name: 'calculate_trip_emissions', ok: false });
    const fr = ((m.calls[1].body.contents as { parts: Part[] }[])[2].parts[0] as { functionResponse: { id?: string; response: { error: unknown } } }).functionResponse;
    expect(fr.id).toBeUndefined(); // Gemini sent no id, so none is echoed
    expect(JSON.stringify(fr.response.error)).toMatch(/distance_km|mode/);
  });

  it('falls back to the next model when the primary is out of quota before the conversation starts', async () => {
    const m = mockFetch([
      fail(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] } }),
      ok(reply([{ text: 'Answer from fallback.' }])),
    ]);
    const provider = new GeminiProvider({ apiKey: 'k', model: 'primary', fallbackModels: ['backup'], fetch: m.fn });
    const res = await ask(provider);
    expect(res.reply).toBe('Answer from fallback.');
    expect(m.calls[1].url).toContain('/models/backup:generateContent');
    expect(provider.model).toBe('backup');
  });

  it('reports quota exhaustion as a graceful llm_error with errorKind "quota"', async () => {
    const quota = () => fail(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota', details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] } });
    const m = mockFetch([quota(), quota()]);
    const res = await ask(new GeminiProvider({ apiKey: 'k', model: 'a', fallbackModels: ['b'], fetch: m.fn }));
    expect(res.status).toBe('llm_error');
    expect(res.errorKind).toBe('quota');
    expect(res.reply).toMatch(/usage limit/);
    expect(res.reply).toMatch(/Insights and Scenario tools still work/);
  });

  it('classifies an invalid key as auth and does not try other models', async () => {
    const m = mockFetch([fail(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } })]);
    const res = await ask(new GeminiProvider({ apiKey: 'bad', fetch: m.fn }));
    expect(res.errorKind).toBe('auth');
    expect(m.calls).toHaveLength(1);
  });

  it('retries a transient 503 once', async () => {
    const m = mockFetch([fail(503, { error: { status: 'UNAVAILABLE' } }), ok(reply([{ text: 'Recovered.' }]))]);
    const res = await ask(new GeminiProvider({ apiKey: 'k', fallbackModels: [], fetch: m.fn }));
    expect(res.reply).toBe('Recovered.');
    expect(m.calls).toHaveLength(2);
  });

  it('times out slow requests', async () => {
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const m = mockFetch([hang, hang]);
    const res = await ask(new GeminiProvider({ apiKey: 'k', fallbackModels: [], timeoutMs: 30, fetch: m.fn }));
    expect(res.status).toBe('llm_error');
    expect(res.errorKind).toBe('timeout');
  });

  it('treats safety stops and blocked prompts as refusals', async () => {
    const m = mockFetch([ok({ candidates: [{ finishReason: 'SAFETY' }] })]);
    expect((await ask(new GeminiProvider({ apiKey: 'k', fetch: m.fn }))).status).toBe('refusal');
    const m2 = mockFetch([ok({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })]);
    expect((await ask(new GeminiProvider({ apiKey: 'k', fetch: m2.fn }))).status).toBe('refusal');
  });

  it('does not execute tool calls from a truncated (MAX_TOKENS) response', async () => {
    const m = mockFetch([ok(reply([{ text: 'Partial' }, { functionCall: { name: 'get_trip_history', args: {} } }], 'MAX_TOKENS'))]);
    const res = await ask(new GeminiProvider({ apiKey: 'k', fetch: m.fn }));
    expect(res.toolRuns).toHaveLength(0);
    expect(res.reply).toBe('Partial');
  });
});

describe('Gemini configuration', () => {
  it('converts schemas: drops unsupported keywords, omits parameters for parameterless tools', () => {
    const decls = toFunctionDeclarations(toolSpecs());
    const prefs = decls.find((d) => d.name === 'get_user_preferences')!;
    expect('parameters' in prefs).toBe(false);
    const calc = decls.find((d) => d.name === 'calculate_trip_emissions') as unknown as { parameters: { type: string; required: string[]; properties: Record<string, unknown> } };
    expect(calc.parameters.type).toBe('object');
    expect(calc.parameters.required).toEqual(expect.arrayContaining(['distance_km', 'mode']));
  });

  it('classifies HTTP errors', () => {
    expect(classifyGeminiError(429, '{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}')).toBe('rate_limited');
    expect(classifyGeminiError(429, '{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}')).toBe('quota');
    expect(classifyGeminiError(403, 'PERMISSION_DENIED')).toBe('auth');
    expect(classifyGeminiError(500, '')).toBe('unavailable');
    expect(classifyGeminiError(400, 'bad schema')).toBe('bad_request');
  });

  it('is the default provider and needs GEMINI_API_KEY', () => {
    expect(providerFromEnv(() => undefined)).toBeNull();
    const p = providerFromEnv((k: string) => ({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-x' } as Record<string, string>)[k]);
    expect(p?.name).toBe('gemini');
    expect(p?.model).toBe('gemini-x');
    expect(geminiFromEnv((k: string) => (k === 'GEMINI_API_KEY' ? 'k' : undefined))?.model).toBe('gemini-3.8-flash');
  });
});
