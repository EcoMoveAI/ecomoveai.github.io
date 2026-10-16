/**
 * Validation for importing an EcoMove JSON export (`ecomove-export-v1`). This is the migration path for
 * trips recorded in the mobile app's on-device mode: export JSON on the phone, import it on the website.
 * Each trip keeps its original calculation snapshot (factor, version, boundary), so imported history is
 * reproduced exactly rather than recalculated. Pure: no platform APIs.
 */
import { GOAL_TYPES, type Goal } from '@core/goals.ts';
import { isTransportMode, type Trip } from '@core/types.ts';
import { EXPORT_FORMAT } from './exportFormat';

export interface ParsedImport {
  trips: Trip[];
  goals: Goal[];
  /** Human-readable reasons for skipped records (first few only). */
  problems: string[];
  skipped: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const optNum = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v));
const optStr = (v: unknown, max: number) => v === null || v === undefined || (typeof v === 'string' && v.length <= max);
const MAX_BYTES = 20_000_000;

function placeOk(p: unknown): boolean {
  if (p === null || p === undefined) return true;
  if (typeof p !== 'object') return false;
  const { label, lat, lng } = p as Record<string, unknown>;
  return optStr(label, 120) && optNum(lat) && optNum(lng) && (lat == null || Math.abs(lat as number) <= 90) && (lng == null || Math.abs(lng as number) <= 180);
}

/** Returns null when the trip is valid, otherwise the reason. */
export function tripProblem(t: Record<string, unknown>): string | null {
  if (typeof t.id !== 'string' || !UUID.test(t.id)) return 'missing or invalid id';
  if (!isIso(t.startedAt) || !isIso(t.endedAt)) return 'invalid start/end time';
  if (Date.parse(t.endedAt) < Date.parse(t.startedAt)) return 'ends before it starts';
  if (Date.parse(t.endedAt) - Date.parse(t.startedAt) > 24 * 3600_000) return 'longer than 24 hours';
  if (typeof t.distanceKm !== 'number' || !Number.isFinite(t.distanceKm) || t.distanceKm < 0 || t.distanceKm > 1500) return 'invalid distance';
  if (!isTransportMode(t.mode)) return 'unknown transport mode';
  if (t.proposedMode != null && !isTransportMode(t.proposedMode)) return 'unknown proposed mode';
  if (t.detectionSource !== 'manual' && t.detectionSource !== 'auto') return 'invalid detection source';
  if (!['confirmed', 'needs_review', 'edited', 'dismissed'].includes(t.confirmationStatus as string)) return 'invalid confirmation status';
  if (!['calculated', 'factor_unavailable', 'invalid_input'].includes(t.calcStatus as string)) return 'invalid calculation status';
  if (t.calcStatus === 'calculated' && (typeof t.emissionsKg !== 'number' || t.emissionsKg < 0 || typeof t.factorId !== 'string')) return 'calculation snapshot incomplete';
  if (typeof t.factorSetId !== 'string' || typeof t.factorSetVersion !== 'string' || typeof t.calcEngineVersion !== 'string') return 'missing methodology version';
  if (!optNum(t.occupancy) || !optNum(t.emissionsKg) || !optNum(t.factorValue) || !optNum(t.classificationConfidence)) return 'invalid number field';
  if (!placeOk(t.origin) || !placeOk(t.destination)) return 'invalid place';
  if (!optStr(t.notes, 500) || !optStr(t.variant, 40) || !optStr(t.dedupeKey, 64)) return 'text field too long';
  if (!isIso(t.createdAt) || !isIso(t.updatedAt) || !isIso(t.calculatedAt)) return 'invalid timestamps';
  return null;
}

function goalProblem(g: Record<string, unknown>): string | null {
  if (typeof g.id !== 'string' || !UUID.test(g.id)) return 'invalid goal id';
  if (!(GOAL_TYPES as readonly string[]).includes(g.type as string)) return 'unknown goal type';
  if (typeof g.targetValue !== 'number' || g.targetValue < 0) return 'invalid goal target';
  if (g.period !== 'week' && g.period !== 'month') return 'invalid goal period';
  if (!['active', 'paused', 'archived'].includes(g.status as string)) return 'invalid goal status';
  if (!isIso(g.createdAt) || !isIso(g.updatedAt)) return 'invalid goal timestamps';
  return null;
}

export function parseImport(text: string): ParsedImport {
  if (text.length > MAX_BYTES) throw new Error('The file is too large to import (limit 20 MB).');
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('This is not a valid JSON file.');
  }
  const d = doc as { format?: unknown; trips?: unknown; goals?: unknown };
  if (!d || typeof d !== 'object' || d.format !== EXPORT_FORMAT) throw new Error(`Not an EcoMove export (expected format "${EXPORT_FORMAT}"). Use "Export as JSON" in the EcoMove app.`);
  const out: ParsedImport = { trips: [], goals: [], problems: [], skipped: 0 };
  const note = (why: string) => {
    out.skipped += 1;
    if (out.problems.length < 5) out.problems.push(why);
  };
  for (const raw of Array.isArray(d.trips) ? d.trips : []) {
    const t = raw as Record<string, unknown>;
    if (!t || typeof t !== 'object') {
      note('trip is not an object');
      continue;
    }
    if (t.deletedAt) continue; // tombstones are not imported
    const why = tripProblem(t);
    if (why) {
      note(`Trip ${typeof t.id === 'string' ? t.id.slice(0, 8) : '?'}: ${why}`);
      continue;
    }
    const { syncStatus: _s, ...plain } = t as unknown as Trip & { syncStatus?: string };
    out.trips.push({ ...plain, deletedAt: null });
  }
  for (const raw of Array.isArray(d.goals) ? d.goals : []) {
    const g = raw as Record<string, unknown>;
    const why = g && typeof g === 'object' ? goalProblem(g) : 'goal is not an object';
    if (why) {
      note(why);
      continue;
    }
    if (g.deletedAt) continue;
    const { syncStatus: _s, ...plain } = g as unknown as Goal & { syncStatus?: string };
    out.goals.push({ ...plain, deletedAt: null });
  }
  return out;
}
