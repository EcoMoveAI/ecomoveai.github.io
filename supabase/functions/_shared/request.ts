/** Shared HTTP helpers for Edge Functions: CORS, JSON responses, auth and body limits. */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export function env(name: string): string | undefined {
  return Deno.env.get(name) ?? undefined;
}

/**
 * CORS for browser callers (the PWA). `ALLOWED_ORIGINS` is a comma-separated list such as
 * `https://ecomove.pages.dev,http://localhost:8081`; when it is unset any origin is allowed, which is safe
 * here because requests are authorised with a bearer token (no cookies) — but setting it is recommended.
 * Native apps send no Origin header and are unaffected.
 */
export function corsHeadersFor(req: Request): Record<string, string> {
  const allowed = (env('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('Origin');
  const allowOrigin = allowed.length === 0 ? '*' : origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Answers CORS preflight requests; returns null for other methods. */
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeadersFor(req) }) : null;
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export class HttpFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Returns a Supabase client that acts as the calling user (RLS applies) plus the verified user. */
export async function authenticate(req: Request): Promise<{ client: SupabaseClient; user: User }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) throw new HttpFailure(401, 'unauthorized', 'Missing bearer token.');
  const url = env('SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY') ?? env('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !anon) throw new HttpFailure(500, 'server_misconfigured', 'Supabase environment is not configured.');
  const client = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(authHeader.slice('Bearer '.length));
  if (error || !data.user) throw new HttpFailure(401, 'unauthorized', 'Invalid or expired session.');
  return { client, user: data.user };
}

export async function readJson(req: Request, maxBytes = 64_000): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new HttpFailure(413, 'payload_too_large', 'Request body too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpFailure(413, 'payload_too_large', 'Request body too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpFailure(400, 'invalid_json', 'Body must be JSON.');
  }
}

export function handleError(req: Request, e: unknown): Response {
  if (e instanceof HttpFailure) return json(req, { error: e.code, message: e.message }, e.status);
  console.error('unhandled', e instanceof Error ? e.name : typeof e);
  return json(req, { error: 'internal_error', message: 'Unexpected server error.' }, 500);
}
