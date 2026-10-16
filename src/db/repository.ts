/**
 * Local, offline-first store. Trips and goals are kept as JSON documents plus indexed columns.
 * Every local change is marked `pending` until the sync engine confirms the server has it.
 * Raw GPS samples are never stored here except inside the in-progress trip detector state, which is
 * cleared as soon as a trip ends.
 */
import type { Goal } from '@core/goals.ts';
import { DEFAULT_PREFERENCES, type Trip, type UserPreferences } from '@core/types.ts';
import { INITIAL_DETECTOR_STATE, type DetectorState } from '@core/detection.ts';
import type { SqlDriver } from './driver';

export type SyncStatus = 'pending' | 'synced';

export interface StoredTrip extends Trip {
  syncStatus: SyncStatus;
}

export interface AppSettings {
  onboardingComplete: boolean;
  privacyConsentVersion: string | null;
  accountMode: 'local' | 'cloud' | null;
  /** User explicitly enabled automatic tracking. */
  trackingEnabled: boolean;
  /** Store exact endpoints instead of ~110 m rounded coordinates. */
  keepPreciseCoords: boolean;
  /** Automatically delete trips older than this many months (null = keep). */
  tripRetentionMonths: number | null;
  notifications: { dailySummary: boolean; weeklyInsight: boolean; monthlyReport: boolean; goalProgress: boolean };
}

export const DEFAULT_SETTINGS: AppSettings = {
  onboardingComplete: false,
  privacyConsentVersion: null,
  accountMode: null,
  trackingEnabled: false,
  keepPreciseCoords: false,
  tripRetentionMonths: null,
  notifications: { dailySummary: false, weeklyInsight: false, monthlyReport: false, goalProgress: false },
};

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS trips (
     id TEXT PRIMARY KEY NOT NULL,
     started_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted_at TEXT,
     dedupe_key TEXT,
     sync_status TEXT NOT NULL DEFAULT 'pending',
     data TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS trips_started_idx ON trips (started_at);
   CREATE INDEX IF NOT EXISTS trips_sync_idx ON trips (sync_status);
   CREATE UNIQUE INDEX IF NOT EXISTS trips_dedupe_idx ON trips (dedupe_key) WHERE dedupe_key IS NOT NULL;
   CREATE TABLE IF NOT EXISTS goals (
     id TEXT PRIMARY KEY NOT NULL,
     updated_at TEXT NOT NULL,
     deleted_at TEXT,
     sync_status TEXT NOT NULL DEFAULT 'pending',
     data TEXT NOT NULL
   );`,
];

interface TripRecord {
  data: string;
  sync_status: SyncStatus;
}

export class Repository {
  private readonly db: SqlDriver;
  constructor(db: SqlDriver) {
    this.db = db;
  }

  async migrate(): Promise<void> {
    const row = await this.db.first<{ user_version: number }>('PRAGMA user_version');
    const current = row?.user_version ?? 0;
    for (let v = current; v < MIGRATIONS.length; v++) {
      await this.db.exec(MIGRATIONS[v]);
      await this.db.exec(`PRAGMA user_version = ${v + 1}`);
    }
  }

  // ---------------------------------------------------------------- key/value
  async getKv<T>(key: string, fallback: T): Promise<T> {
    const r = await this.db.first<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
    if (!r) return fallback;
    try {
      return JSON.parse(r.value) as T;
    } catch {
      return fallback;
    }
  }

  async setKv(key: string, value: unknown): Promise<void> {
    await this.db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
  }

  async deleteKv(key: string): Promise<void> {
    await this.db.run('DELETE FROM kv WHERE key = ?', [key]);
  }

  async getSettings(): Promise<AppSettings> {
    const s = await this.getKv<Partial<AppSettings>>('settings', {});
    return { ...DEFAULT_SETTINGS, ...s, notifications: { ...DEFAULT_SETTINGS.notifications, ...(s.notifications ?? {}) } };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...(await this.getSettings()), ...patch };
    await this.setKv('settings', next);
    return next;
  }

  async getPreferences(): Promise<UserPreferences> {
    return { ...DEFAULT_PREFERENCES, ...(await this.getKv<Partial<UserPreferences>>('preferences', {})) };
  }

  async setPreferences(p: UserPreferences): Promise<void> {
    await this.setKv('preferences', p);
  }

  async getDetectorState(): Promise<DetectorState> {
    return this.getKv<DetectorState>('detector_state', INITIAL_DETECTOR_STATE);
  }

  async setDetectorState(s: DetectorState): Promise<void> {
    await this.setKv('detector_state', s);
  }

  // ---------------------------------------------------------------- trips
  private toTrip(r: TripRecord): StoredTrip {
    return { ...(JSON.parse(r.data) as Trip), syncStatus: r.sync_status };
  }

  async listTrips(opts: { start?: string; end?: string; includeDeleted?: boolean } = {}): Promise<StoredTrip[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (!opts.includeDeleted) where.push('deleted_at IS NULL');
    if (opts.start) {
      where.push('started_at >= ?');
      params.push(opts.start);
    }
    if (opts.end) {
      where.push('started_at < ?');
      params.push(opts.end);
    }
    const sql = `SELECT data, sync_status FROM trips ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at DESC`;
    return (await this.db.all<TripRecord>(sql, params)).map((r) => this.toTrip(r));
  }

  async getTrip(id: string): Promise<StoredTrip | null> {
    const r = await this.db.first<TripRecord>('SELECT data, sync_status FROM trips WHERE id = ?', [id]);
    return r ? this.toTrip(r) : null;
  }

  async findByDedupeKey(key: string): Promise<StoredTrip | null> {
    const r = await this.db.first<TripRecord>('SELECT data, sync_status FROM trips WHERE dedupe_key = ?', [key]);
    return r ? this.toTrip(r) : null;
  }

  /** Inserts or replaces a trip. `syncStatus` defaults to `pending` (a local change). */
  async saveTrip(trip: Trip, syncStatus: SyncStatus = 'pending'): Promise<void> {
    const { syncStatus: _ignored, ...plain } = trip as StoredTrip;
    await this.db.run(
      `INSERT INTO trips (id, started_at, updated_at, deleted_at, dedupe_key, sync_status, data) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
         dedupe_key = excluded.dedupe_key, sync_status = excluded.sync_status, data = excluded.data`,
      [plain.id, plain.startedAt, plain.updatedAt, plain.deletedAt, plain.dedupeKey, syncStatus, JSON.stringify(plain)],
    );
  }

  /** Marks a trip deleted (tombstone) so the deletion can be synced; content is erased locally at once. */
  async softDeleteTrip(id: string, now: Date): Promise<void> {
    const t = await this.getTrip(id);
    if (!t) return;
    const tomb: Trip = { ...t, deletedAt: now.toISOString(), updatedAt: now.toISOString(), origin: null, destination: null, notes: null };
    await this.saveTrip(tomb, 'pending');
  }

  async hardDeleteTrip(id: string): Promise<void> {
    await this.db.run('DELETE FROM trips WHERE id = ?', [id]);
  }

  async pendingTrips(): Promise<StoredTrip[]> {
    return (await this.db.all<TripRecord>("SELECT data, sync_status FROM trips WHERE sync_status = 'pending' ORDER BY updated_at")).map((r) => this.toTrip(r));
  }

  /** Marks trips synced only if they were not modified again after the given version was pushed. */
  async markTripSynced(id: string, pushedUpdatedAt: string): Promise<void> {
    await this.db.run("UPDATE trips SET sync_status = 'synced' WHERE id = ? AND updated_at = ?", [id, pushedUpdatedAt]);
  }

  async countPending(): Promise<number> {
    const r = await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM trips WHERE sync_status = 'pending'");
    const g = await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM goals WHERE sync_status = 'pending'");
    return (r?.n ?? 0) + (g?.n ?? 0);
  }

  /** Deletes trips that started before `cutoff` (retention policy). Returns ids for tombstone sync. */
  async tripsOlderThan(cutoffIso: string): Promise<string[]> {
    return (await this.db.all<{ id: string }>('SELECT id FROM trips WHERE started_at < ? AND deleted_at IS NULL', [cutoffIso])).map((r) => r.id);
  }

  // ---------------------------------------------------------------- goals
  async listGoals(includeDeleted = false): Promise<(Goal & { syncStatus: SyncStatus })[]> {
    const rows = await this.db.all<TripRecord>(`SELECT data, sync_status FROM goals ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY updated_at DESC`);
    return rows.map((r) => ({ ...(JSON.parse(r.data) as Goal), syncStatus: r.sync_status }));
  }

  async saveGoal(goal: Goal, syncStatus: SyncStatus = 'pending'): Promise<void> {
    const { syncStatus: _ignored, ...plain } = goal as Goal & { syncStatus?: SyncStatus };
    await this.db.run(
      `INSERT INTO goals (id, updated_at, deleted_at, sync_status, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, sync_status = excluded.sync_status, data = excluded.data`,
      [plain.id, plain.updatedAt, plain.deletedAt, syncStatus, JSON.stringify(plain)],
    );
  }

  async pendingGoals(): Promise<Goal[]> {
    return (await this.db.all<TripRecord>("SELECT data, sync_status FROM goals WHERE sync_status = 'pending'")).map((r) => JSON.parse(r.data) as Goal);
  }

  async markGoalSynced(id: string, pushedUpdatedAt: string): Promise<void> {
    await this.db.run("UPDATE goals SET sync_status = 'synced' WHERE id = ? AND updated_at = ?", [id, pushedUpdatedAt]);
  }

  async getGoal(id: string): Promise<(Goal & { syncStatus: SyncStatus }) | null> {
    const r = await this.db.first<TripRecord>('SELECT data, sync_status FROM goals WHERE id = ?', [id]);
    return r ? { ...(JSON.parse(r.data) as Goal), syncStatus: r.sync_status } : null;
  }

  async hardDeleteGoal(id: string): Promise<void> {
    await this.db.run('DELETE FROM goals WHERE id = ?', [id]);
  }

  /** Runs several repository writes atomically (used by data import). */
  async transactionally(fn: () => Promise<void>): Promise<void> {
    await this.db.transaction(fn);
  }

  // ---------------------------------------------------------------- wipe
  /** Removes all personal data from the device (trips, goals, detector state, sync cursors). */
  async wipePersonalData(): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM trips');
      await this.db.run('DELETE FROM goals');
      await this.db.run("DELETE FROM kv WHERE key IN ('detector_state', 'sync_cursor_trips', 'sync_cursor_tombstones', 'sync_cursor_goals', 'last_sync')");
    });
  }

  async wipeEverything(): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM trips');
      await this.db.run('DELETE FROM goals');
      await this.db.run('DELETE FROM kv');
    });
  }
}
