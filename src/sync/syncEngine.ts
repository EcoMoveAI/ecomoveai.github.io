/**
 * Offline-first synchronisation.
 *
 *  push: pending local trips → `sync_push_trips` RPC (idempotent upsert keyed by client UUID, last-write-wins on
 *        the client `updated_at`, deletions as tombstones). Retrying after a network error is always safe.
 *  pull: rows whose server receive time is newer than the stored cursor. A pulled row never overwrites a
 *        local pending edit that is newer (same last-write-wins rule as the server).
 *
 * Conflict rule (documented in docs/ARCHITECTURE.md): the edit with the later client `updated_at` wins;
 * a deletion wins over any edit made before it.
 */
import { rowToTrip, tripToRow } from '@core/remote.ts';
import type { Repository } from '@/db/repository';
import { goalToRow, rowToGoal, type RemoteStore } from './remoteStore';

const BATCH = 200;
/** Re-read a small overlap so rows committed out of order around the cursor are not missed. */
const CURSOR_OVERLAP_MS = 60_000;

export interface SyncResult {
  pushed: number;
  rejectedAsStale: number;
  pulled: number;
  deletedFromServer: number;
  errors: string[];
}

function rewind(cursor: string | null): string | null {
  return cursor ? new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString() : null;
}

export async function syncAll(repo: Repository, remote: RemoteStore): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, rejectedAsStale: 0, pulled: 0, deletedFromServer: 0, errors: [] };

  // ---------------- push trips
  try {
    const pending = await repo.pendingTrips();
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const res = await remote.pushTrips(batch.map((t) => tripToRow(t)));
      const applied = new Map(res.map((r) => [r.trip_id, r.applied]));
      for (const t of batch) {
        if (!applied.has(t.id)) continue;
        if (applied.get(t.id)) result.pushed += 1;
        else result.rejectedAsStale += 1; // server already has a newer version; pull will bring it
        if (t.deletedAt) await repo.hardDeleteTrip(t.id);
        else await repo.markTripSynced(t.id, t.updatedAt);
      }
    }
  } catch (e) {
    result.errors.push(`push trips: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---------------- push goals
  try {
    const goals = await repo.pendingGoals();
    if (goals.length) {
      await remote.pushGoals(goals.map(goalToRow));
      for (const g of goals) await repo.markGoalSynced(g.id, g.updatedAt);
    }
  } catch (e) {
    result.errors.push(`push goals: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---------------- pull trips
  try {
    let cursor = await repo.getKv<string | null>('sync_cursor_trips', null);
    for (;;) {
      const rows = await remote.pullTrips(rewind(cursor), 1000);
      let maxSeen = cursor;
      for (const row of rows) {
        const remoteTrip = rowToTrip(row);
        const local = await repo.getTrip(remoteTrip.id);
        const localNewer = local && local.syncStatus === 'pending' && Date.parse(local.updatedAt) > Date.parse(remoteTrip.updatedAt);
        if (!localNewer && !(local && local.updatedAt === remoteTrip.updatedAt && local.syncStatus === 'synced')) {
          await repo.saveTrip(remoteTrip, 'synced');
          result.pulled += 1;
        }
        if (row.server_updated_at && (!maxSeen || row.server_updated_at > maxSeen)) maxSeen = new Date(row.server_updated_at).toISOString();
      }
      const advanced = maxSeen !== cursor;
      cursor = maxSeen;
      await repo.setKv('sync_cursor_trips', cursor);
      if (rows.length < 1000 || !advanced) break;
    }
  } catch (e) {
    result.errors.push(`pull trips: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---------------- pull deletions
  try {
    const cursor = await repo.getKv<string | null>('sync_cursor_tombstones', null);
    const rows = await remote.pullTombstones(rewind(cursor), 5000);
    let maxSeen = cursor;
    for (const t of rows) {
      const local = await repo.getTrip(t.trip_id);
      if (local && !(local.syncStatus === 'pending' && Date.parse(local.updatedAt) > Date.parse(t.deleted_at))) {
        await repo.hardDeleteTrip(t.trip_id);
        result.deletedFromServer += 1;
      }
      const s = new Date(t.server_updated_at).toISOString();
      if (!maxSeen || s > maxSeen) maxSeen = s;
    }
    await repo.setKv('sync_cursor_tombstones', maxSeen);
  } catch (e) {
    result.errors.push(`pull deletions: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---------------- pull goals
  try {
    const cursor = await repo.getKv<string | null>('sync_cursor_goals', null);
    const rows = await remote.pullGoals(rewind(cursor), 1000);
    let maxSeen = cursor;
    for (const r of rows) {
      const g = rowToGoal(r);
      const local = await repo.getGoal(g.id);
      if (!(local && local.syncStatus === 'pending' && Date.parse(local.updatedAt) > Date.parse(g.updatedAt))) await repo.saveGoal(g, 'synced');
      if (r.server_updated_at) {
        const s = new Date(r.server_updated_at).toISOString();
        if (!maxSeen || s > maxSeen) maxSeen = s;
      }
    }
    await repo.setKv('sync_cursor_goals', maxSeen);
  } catch (e) {
    result.errors.push(`pull goals: ${e instanceof Error ? e.message : String(e)}`);
  }

  await repo.setKv('last_sync', { at: new Date().toISOString(), ok: result.errors.length === 0 });
  return result;
}
