/**
 * Agent data port backed by Supabase. The client is created with the caller's JWT, so every query is
 * filtered by Row Level Security to the authenticated user's own rows. No service-role key is used here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentDataPort } from './core/agent/tools.ts';
import { rowToTrip, type TripRow } from './core/remote.ts';
import type { RouteProvider } from './core/routing.ts';
import { isValidTimeZone } from './core/time.ts';
import { DEFAULT_PREFERENCES, isTransportMode, type Trip, type UserPreferences } from './core/types.ts';

const MAX_TRIPS_PER_QUERY = 5000;

export function createSupabaseDataPort(client: SupabaseClient, routeProvider: RouteProvider, now: () => Date = () => new Date()): AgentDataPort {
  let prefs: Promise<UserPreferences> | null = null;
  return {
    routeProvider,
    now,
    async listTrips(window): Promise<Trip[]> {
      const { data, error } = await client
        .from('trips')
        .select('*')
        .gte('started_at', window.start)
        .lt('started_at', window.end)
        .order('started_at', { ascending: true })
        .limit(MAX_TRIPS_PER_QUERY);
      if (error) throw new Error(`trip query failed: ${error.code ?? 'unknown'}`);
      return (data as TripRow[]).map(rowToTrip);
    },
    getPreferences() {
      prefs ??= (async () => {
        const { data, error } = await client.from('profiles').select('*').maybeSingle();
        if (error || !data) return DEFAULT_PREFERENCES;
        const tz = typeof data.time_zone === 'string' && isValidTimeZone(data.time_zone) ? data.time_zone : DEFAULT_PREFERENCES.timeZone;
        return {
          timeZone: tz,
          factorSetId: data.factor_set_id ?? DEFAULT_PREFERENCES.factorSetId,
          defaultCarOccupancy: data.default_car_occupancy ?? 1,
          defaultMotorcycleOccupancy: data.default_motorcycle_occupancy ?? 1,
          maxExtraMinutes: data.max_extra_minutes ?? null,
          preferredModes: (data.preferred_modes ?? []).filter(isTransportMode),
          avoidModes: (data.avoid_modes ?? []).filter(isTransportMode),
          accessibilityNotes: data.accessibility_notes ?? null,
          units: 'metric',
        } satisfies UserPreferences;
      })();
      return prefs;
    },
  };
}
