/**
 * POST /functions/v1/mobility-assistant
 * Body: { messages: { role: 'user' | 'assistant', content: string }[] }
 *
 * Runs the tool-using sustainability agent for the authenticated user (Gemini by default, see
 * _shared/llm/index.ts). Request flow:
 *   1. verify the caller's JWT (also enforced by the platform: verify_jwt = true);
 *   2. validate the request and the per-user hourly limit;
 *   3. build a data port whose Supabase client carries the caller's JWT, so every query is limited by
 *      Row Level Security to the caller's own rows — the model can never widen this;
 *   4. let the model call the 10 validated tools (bounded steps, per-tool timeout, overall deadline);
 *   5. return the grounded reply.
 * The LLM key never leaves the server. Only execution metadata (tool names, durations, token counts) is
 * stored or logged — never prompts, answers or locations.
 */
import { runAgent, type ChatMessage } from '../_shared/core/agent/orchestrator.ts';
import { GoogleRoutesProvider, UnavailableRouteProvider } from '../_shared/core/routing.ts';
import { createSupabaseDataPort } from '../_shared/dataPort.ts';
import { providerFromEnv, requiredSecretName } from '../_shared/llm/index.ts';
import { authenticate, env, handleError, HttpFailure, json, preflight, readJson } from '../_shared/request.ts';

const HOURLY_LIMIT = Number(env('AGENT_HOURLY_LIMIT') ?? '30');
const MAX_MESSAGES = 20;
const MAX_CHARS = 4000;

function parseMessages(body: unknown): ChatMessage[] {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) {
    throw new HttpFailure(400, 'invalid_request', `messages must be a non-empty array (max ${MAX_MESSAGES}).`);
  }
  return raw.map((m, i) => {
    const ok = !!m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= MAX_CHARS;
    if (!ok) throw new HttpFailure(400, 'invalid_request', `messages[${i}] must be { role: "user" | "assistant", content: string ≤ ${MAX_CHARS} chars }.`);
    return { role: m.role, content: m.content } as ChatMessage;
  });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const started = Date.now();
  try {
    const { client } = await authenticate(req);
    const messages = parseMessages(await readJson(req));

    const provider = providerFromEnv(env);
    if (!provider) {
      throw new HttpFailure(503, 'llm_not_configured', `The AI assistant is not configured on this server (set ${requiredSecretName(env)}).`);
    }

    // Per-user rate limit (agent_runs is RLS-scoped and append-only for users).
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await client.from('agent_runs').select('id', { count: 'exact', head: true }).gte('created_at', since);
    if ((count ?? 0) >= HOURLY_LIMIT) throw new HttpFailure(429, 'rate_limited', 'Hourly assistant limit reached. Please try again later.');

    const mapsKey = env('GOOGLE_MAPS_API_KEY');
    const routeProvider = mapsKey ? new GoogleRoutesProvider(mapsKey) : new UnavailableRouteProvider();
    const data = createSupabaseDataPort(client, routeProvider);
    const prefs = await data.getPreferences();
    const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: prefs.timeZone });

    const result = await runAgent({
      provider,
      ctx: { data },
      messages,
      contextNote: `current local time ${nowLocal} (${prefs.timeZone}); routing provider: ${routeProvider.name}`,
      deadlineMs: 100_000,
    });

    await client.from('agent_runs').insert({
      provider: provider.name,
      model: provider.model,
      status: result.errorKind ? `${result.status}:${result.errorKind}` : result.status,
      steps: result.steps,
      tools: result.toolRuns.map((t) => ({ name: t.name, ok: t.ok, ms: t.durationMs })),
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      latency_ms: Date.now() - started,
    });

    return json(req, {
      reply: result.reply,
      status: result.status,
      ...(result.errorKind ? { errorKind: result.errorKind } : {}),
      tools: result.toolRuns.map((t) => ({ name: t.name, ok: t.ok })),
      model: provider.model,
    });
  } catch (e) {
    return handleError(req, e);
  }
});
