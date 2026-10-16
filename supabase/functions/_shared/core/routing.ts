/**
 * Route-provider interface and a Google Maps Platform Routes API implementation.
 * The provider only returns distances, durations and the transport modes of each route segment;
 * emissions are always computed by the deterministic calculation engine.
 */
import { fetchWithRetry } from './http.ts';
import type { TransportMode } from './types.ts';

export type RouteTravelMode = 'drive' | 'two_wheeler' | 'walk' | 'bicycle' | 'transit';

export interface RouteRequest {
  origin: string;
  destination: string;
  travelModes: RouteTravelMode[];
  /** ISO time; used for transit schedules. */
  departureTime?: string;
}

export interface RouteSegment {
  mode: TransportMode;
  distanceKm: number;
  /** e.g. transit line short name. */
  label?: string;
}

export interface RouteOption {
  provider: string;
  travelMode: RouteTravelMode;
  durationMin: number;
  distanceKm: number;
  segments: RouteSegment[];
  summary: string;
}

export interface RouteResult {
  available: boolean;
  provider: string;
  options: RouteOption[];
  errors: string[];
}

export interface RouteProvider {
  readonly name: string;
  getRoutes(req: RouteRequest): Promise<RouteResult>;
}

/** Used when no routing credentials are configured. Never fabricates routes. */
export class UnavailableRouteProvider implements RouteProvider {
  readonly name = 'none';
  private readonly reason: string;
  constructor(reason = 'No routing provider is configured (set GOOGLE_MAPS_API_KEY on the server).') {
    this.reason = reason;
  }
  async getRoutes(): Promise<RouteResult> {
    return { available: false, provider: this.name, options: [], errors: [this.reason] };
  }
}

const GOOGLE_MODE: Record<RouteTravelMode, string> = {
  drive: 'DRIVE',
  two_wheeler: 'TWO_WHEELER',
  walk: 'WALK',
  bicycle: 'BICYCLE',
  transit: 'TRANSIT',
};

const DIRECT_MODE: Record<Exclude<RouteTravelMode, 'transit'>, TransportMode> = {
  drive: 'car',
  two_wheeler: 'motorcycle',
  walk: 'walking',
  bicycle: 'cycling',
};

export function mapGoogleVehicleType(type: string | undefined): TransportMode {
  switch (type) {
    case 'BUS':
    case 'INTERCITY_BUS':
    case 'TROLLEYBUS':
      return 'bus';
    case 'SUBWAY':
    case 'METRO_RAIL':
    case 'LIGHT_RAIL':
    case 'MONORAIL':
    case 'TRAM':
      return 'metro';
    case 'HIGH_SPEED_TRAIN':
      return 'hsr';
    case 'HEAVY_RAIL':
    case 'COMMUTER_TRAIN':
    case 'LONG_DISTANCE_TRAIN':
    case 'RAIL':
      return 'train';
    default:
      return 'other_public';
  }
}

function parseDuration(d: unknown): number {
  if (typeof d !== 'string') return NaN;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(d);
  return m ? Number(m[1]) / 60 : NaN;
}

interface GoogleStep {
  distanceMeters?: number;
  travelMode?: string;
  transitDetails?: { transitLine?: { nameShort?: string; name?: string; vehicle?: { type?: string } } };
}
interface GoogleRoute {
  distanceMeters?: number;
  duration?: string;
  description?: string;
  legs?: { steps?: GoogleStep[] }[];
}

export function parseGoogleRoutes(json: unknown, travelMode: RouteTravelMode): RouteOption[] {
  const routes = (json as { routes?: GoogleRoute[] })?.routes ?? [];
  const out: RouteOption[] = [];
  for (const r of routes) {
    const distanceKm = (r.distanceMeters ?? NaN) / 1000;
    const durationMin = parseDuration(r.duration);
    if (!Number.isFinite(distanceKm) || !Number.isFinite(durationMin)) continue;
    let segments: RouteSegment[];
    if (travelMode === 'transit') {
      const merged = new Map<string, RouteSegment>();
      for (const step of r.legs?.flatMap((l) => l.steps ?? []) ?? []) {
        const km = (step.distanceMeters ?? 0) / 1000;
        const mode: TransportMode = step.travelMode === 'TRANSIT' ? mapGoogleVehicleType(step.transitDetails?.transitLine?.vehicle?.type) : 'walking';
        const label = step.transitDetails?.transitLine?.nameShort ?? step.transitDetails?.transitLine?.name;
        const key = `${mode}:${label ?? ''}`;
        const seg = merged.get(key) ?? { mode, distanceKm: 0, label };
        seg.distanceKm += km;
        merged.set(key, seg);
      }
      segments = [...merged.values()].filter((s) => s.distanceKm > 0);
    } else {
      segments = [{ mode: DIRECT_MODE[travelMode], distanceKm }];
    }
    const summary =
      travelMode === 'transit'
        ? segments.filter((s) => s.mode !== 'walking').map((s) => s.label ?? s.mode).join(' → ') || 'Transit'
        : r.description || GOOGLE_MODE[travelMode].toLowerCase();
    out.push({ provider: 'google_routes', travelMode, durationMin, distanceKm, segments, summary });
  }
  return out;
}

export class GoogleRoutesProvider implements RouteProvider {
  readonly name = 'google_routes';
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async getRoutes(req: RouteRequest): Promise<RouteResult> {
    const options: RouteOption[] = [];
    const errors: string[] = [];
    await Promise.all(
      req.travelModes.map(async (mode) => {
        const body: Record<string, unknown> = {
          origin: { address: req.origin },
          destination: { address: req.destination },
          travelMode: GOOGLE_MODE[mode],
          computeAlternativeRoutes: mode === 'transit',
          languageCode: 'en',
          units: 'METRIC',
        };
        if (req.departureTime && mode === 'transit') body.departureTime = req.departureTime;
        try {
          const res = await fetchWithRetry(
            'https://routes.googleapis.com/directions/v2:computeRoutes',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': this.apiKey,
                'X-Goog-FieldMask':
                  'routes.distanceMeters,routes.duration,routes.description,routes.legs.steps.distanceMeters,routes.legs.steps.travelMode,routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.name,routes.legs.steps.transitDetails.transitLine.vehicle.type',
              },
              body: JSON.stringify(body),
            },
            { fetchImpl: this.fetchImpl, timeoutMs: 12_000, retries: 1 },
          );
          if (!res.ok) {
            errors.push(`${mode}: routing provider returned HTTP ${res.status}`);
            return;
          }
          const parsed = parseGoogleRoutes(await res.json(), mode);
          if (!parsed.length) errors.push(`${mode}: no route found`);
          options.push(...parsed);
        } catch (e) {
          errors.push(`${mode}: ${e instanceof Error ? e.message : 'request failed'}`);
        }
      }),
    );
    return { available: options.length > 0, provider: this.name, options, errors };
  }
}
