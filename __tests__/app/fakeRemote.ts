import type { TripRow } from '@core/remote.ts';
import type { GoalRow, RemoteStore, TombstoneRow } from '@/sync/remoteStore';

/**
 * In-memory server with the same semantics as `public.sync_push_trips` (see the SQL migration):
 * last-write-wins on client updated_at, tombstones beat older edits, server_updated_at as the sync cursor.
 */
export class FakeRemote implements RemoteStore {
  trips = new Map<string, TripRow>();
  tombstones = new Map<string, TombstoneRow>();
  goals = new Map<string, GoalRow>();
  failNext = 0;
  pushCalls = 0;
  private clock = Date.parse('2026-10-10T00:00:00Z');

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private maybeFail() {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('network request failed');
    }
  }

  async pushTrips(rows: TripRow[]) {
    this.pushCalls += 1;
    this.maybeFail();
    return rows.map((r) => {
      if (r.deleted_at) {
        const existing = this.trips.get(r.id);
        if (existing && existing.updated_at <= r.updated_at) this.trips.delete(r.id);
        this.tombstones.set(r.id, { trip_id: r.id, deleted_at: r.deleted_at, server_updated_at: this.tick() });
        return { trip_id: r.id, applied: true };
      }
      const tomb = this.tombstones.get(r.id);
      if (tomb && tomb.deleted_at >= r.updated_at) return { trip_id: r.id, applied: false };
      const existing = this.trips.get(r.id);
      if (existing && existing.updated_at > r.updated_at) return { trip_id: r.id, applied: false };
      const { deleted_at: _d, ...clean } = r;
      this.trips.set(r.id, { ...clean, server_updated_at: this.tick() });
      return { trip_id: r.id, applied: true };
    });
  }

  async pullTrips(since: string | null, limit: number) {
    this.maybeFail();
    return [...this.trips.values()]
      .filter((r) => !since || (r.server_updated_at as string) > since)
      .sort((a, b) => (a.server_updated_at as string).localeCompare(b.server_updated_at as string))
      .slice(0, limit);
  }

  async pullTombstones(since: string | null) {
    return [...this.tombstones.values()].filter((t) => !since || t.server_updated_at > since);
  }

  async pushGoals(rows: GoalRow[]) {
    this.maybeFail();
    for (const r of rows) this.goals.set(r.id, { ...r, server_updated_at: this.tick() });
  }

  async pullGoals(since: string | null) {
    return [...this.goals.values()].filter((g) => !since || (g.server_updated_at as string) > since);
  }
}
