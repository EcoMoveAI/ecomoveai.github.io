/// <reference path="../../supabase/functions/_shared/deno-shim.d.ts" />
/**
 * @jest-environment node
 *
 * Edge Function HTTP helpers (CORS for the PWA, auth header handling, body limits) with a minimal Deno shim.
 * The deployed functions themselves need the Supabase runtime; see docs/TESTING.md for the live checks.
 */
const envVars: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => envVars[k] } };

// eslint-disable-next-line import/first
import { authenticate, corsHeadersFor, handleError, HttpFailure, preflight, readJson } from '../../supabase/functions/_shared/request';

const req = (init: RequestInit & { origin?: string } = {}) =>
  new Request('https://x.supabase.co/functions/v1/mobility-assistant', { method: 'POST', ...init, headers: { ...(init.origin ? { Origin: init.origin } : {}), ...(init.headers as Record<string, string>) } });

describe('Edge Function request helpers', () => {
  afterEach(() => {
    for (const k of Object.keys(envVars)) delete envVars[k];
  });

  it('allows any origin when ALLOWED_ORIGINS is unset (bearer-token API, no cookies)', () => {
    expect(corsHeadersFor(req({ origin: 'https://evil.example' }))['Access-Control-Allow-Origin']).toBe('*');
  });

  it('restricts CORS to the configured origins', () => {
    envVars.ALLOWED_ORIGINS = 'https://ecomove.pages.dev, http://localhost:8081';
    expect(corsHeadersFor(req({ origin: 'http://localhost:8081' }))['Access-Control-Allow-Origin']).toBe('http://localhost:8081');
    expect(corsHeadersFor(req({ origin: 'https://evil.example' }))['Access-Control-Allow-Origin']).toBe('https://ecomove.pages.dev');
  });

  it('answers preflight requests and only those', () => {
    expect(preflight(req({ method: 'OPTIONS' }))?.status).toBe(200);
    expect(preflight(req())).toBeNull();
  });

  it('rejects calls without a bearer token before touching the database', async () => {
    await expect(authenticate(req())).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('enforces body size and JSON validity', async () => {
    await expect(readJson(req({ body: 'x'.repeat(70_000) }))).rejects.toMatchObject({ status: 413 });
    await expect(readJson(req({ body: '{not json' }))).rejects.toMatchObject({ status: 400, code: 'invalid_json' });
  });

  it('never leaks internal error details', async () => {
    const res = handleError(req(), new Error('db password is hunter2'));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('hunter2');
    const known = handleError(req(), new HttpFailure(429, 'rate_limited', 'Hourly assistant limit reached.'));
    expect(known.status).toBe(429);
    expect(known.headers.get('Cache-Control')).toBe('no-store');
  });
});
