import type { SupabaseClient } from '@supabase/supabase-js';
import type { TripRow } from '@core/remote.ts';
import type { GoalRow, RemoteStore, TombstoneRow } from './remoteStore';

export function createSupabaseRemote(client: SupabaseClient): RemoteStore {
  return {
    async pushTrips(rows) {
      if (!rows.length) return [];
      const { data, error } = await client.rpc('sync_push_trips', { p_trips: rows });
      if (error) throw new Error(error.message);
      return (data ?? []) as { trip_id: string; applied: boolean }[];
    },
    async pullTrips(since, limit) {
      let q = client.from('trips').select('*').order('server_updated_at', { ascending: true }).limit(limit);
      if (since) q = q.gt('server_updated_at', since);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as TripRow[];
    },
    async pullTombstones(since, limit) {
      let q = client.from('trip_tombstones').select('trip_id, deleted_at, server_updated_at').order('server_updated_at', { ascending: true }).limit(limit);
      if (since) q = q.gt('server_updated_at', since);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as TombstoneRow[];
    },
    async pushGoals(rows) {
      const { error } = await client.from('goals').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    },
    async pullGoals(since, limit) {
      let q = client.from('goals').select('*').order('server_updated_at', { ascending: true }).limit(limit);
      if (since) q = q.gt('server_updated_at', since);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as GoalRow[];
    },
  };
}
