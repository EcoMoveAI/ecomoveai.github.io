/**
 * POST /functions/v1/routes
 * Body: { origin: string, destination: string, travelModes?: ('drive'|'two_wheeler'|'walk'|'bicycle'|'transit')[] }
 *
 * Server-side proxy to the routing provider so the Maps API key never ships in the app or website.
 * Returns { available: false } when no provider is configured — the app then asks for a manual distance.
 */
import { GoogleRoutesProvider, UnavailableRouteProvider, type RouteTravelMode } from '../_shared/core/routing.ts';
import { authenticate, env, handleError, HttpFailure, json, preflight, readJson } from '../_shared/request.ts';

const MODES: RouteTravelMode[] = ['drive', 'two_wheeler', 'walk', 'bicycle', 'transit'];

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  try {
    await authenticate(req);
    const body = (await readJson(req, 4_000)) as { origin?: unknown; destination?: unknown; travelModes?: unknown };
    const origin = typeof body.origin === 'string' ? body.origin.trim() : '';
    const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
    if (origin.length < 2 || origin.length > 200 || destination.length < 2 || destination.length > 200) {
      throw new HttpFailure(400, 'invalid_request', 'origin and destination must be 2–200 characters.');
    }
    const travelModes = Array.isArray(body.travelModes)
      ? body.travelModes.filter((m): m is RouteTravelMode => MODES.includes(m as RouteTravelMode))
      : ['drive'] as RouteTravelMode[];
    if (!travelModes.length) throw new HttpFailure(400, 'invalid_request', 'No supported travel modes.');
    const key = env('GOOGLE_MAPS_API_KEY');
    const provider = key ? new GoogleRoutesProvider(key) : new UnavailableRouteProvider();
    return json(req, await provider.getRoutes({ origin, destination, travelModes }));
  } catch (e) {
    return handleError(req, e);
  }
});
