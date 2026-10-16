import type { Goal } from '@core/goals.ts';
import type { TripRow } from '@core/remote.ts';

export interface TombstoneRow {
  trip_id: string;
  deleted_at: string;
  server_updated_at: string;
}

export interface GoalRow {
  id: string;
  type: string;
  target_value: number;
  period: string;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  server_updated_at?: string;
}

/** Server operations used by the sync engine. Implemented by Supabase in the app and by a fake in tests. */
export interface RemoteStore {
  pushTrips(rows: TripRow[]): Promise<{ trip_id: string; applied: boolean }[]>;
  pullTrips(since: string | null, limit: number): Promise<TripRow[]>;
  pullTombstones(since: string | null, limit: number): Promise<TombstoneRow[]>;
  pushGoals(rows: GoalRow[]): Promise<void>;
  pullGoals(since: string | null, limit: number): Promise<GoalRow[]>;
}

export function goalToRow(g: Goal): GoalRow {
  return { id: g.id, type: g.type, target_value: g.targetValue, period: g.period, status: g.status, created_at: g.createdAt, updated_at: g.updatedAt, deleted_at: g.deletedAt };
}

export function rowToGoal(r: GoalRow): Goal {
  return {
    id: r.id,
    type: r.type as Goal['type'],
    targetValue: Number(r.target_value),
    period: r.period as Goal['period'],
    status: r.status as Goal['status'],
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
  };
}
