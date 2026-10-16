/** Export file formats shared by the native and web builds (pure; no platform APIs). */
import type { Goal } from '@core/goals.ts';
import type { Trip, UserPreferences } from '@core/types.ts';

export const EXPORT_FORMAT = 'ecomove-export-v1';

const CSV_COLUMNS: (keyof Trip)[] = [
  'id', 'startedAt', 'endedAt', 'distanceKm', 'mode', 'variant', 'occupancy', 'detectionSource', 'confirmationStatus',
  'classificationConfidence', 'calcStatus', 'emissionsKg', 'factorId', 'factorValue', 'factorUnit', 'factorSetId',
  'factorSetVersion', 'boundary', 'calcMethod', 'calcEngineVersion', 'notes', 'createdAt', 'updatedAt',
];

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tripsToCsv(trips: Trip[]): string {
  const header = [...CSV_COLUMNS, 'originLabel', 'destinationLabel'].join(',');
  const lines = trips.map((t) => [...CSV_COLUMNS.map((c) => csvCell(t[c])), csvCell(t.origin?.label), csvCell(t.destination?.label)].join(','));
  return [header, ...lines].join('\n');
}

export function buildExportJson(data: { trips: Trip[]; goals: Goal[]; preferences: UserPreferences }): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), format: EXPORT_FORMAT, ...data }, null, 2);
}
