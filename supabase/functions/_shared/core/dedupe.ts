/**
 * Duplicate-trip detection. Several background sessions (or a manual entry plus an automatic detection)
 * can describe the same journey; a candidate is a duplicate when its time interval mostly overlaps an
 * existing trip and the distances are similar.
 */
import { isCountable } from './analytics.ts';
import type { Trip } from './types.ts';

export interface TripSpan {
  startedAt: string;
  endedAt: string;
  distanceKm: number;
}

/** Overlap duration divided by the shorter trip's duration (0–1). */
export function overlapRatio(a: TripSpan, b: TripSpan): number {
  const as = Date.parse(a.startedAt);
  const ae = Date.parse(a.endedAt);
  const bs = Date.parse(b.startedAt);
  const be = Date.parse(b.endedAt);
  const overlap = Math.min(ae, be) - Math.max(as, bs);
  if (overlap <= 0) return 0;
  const shorter = Math.max(1, Math.min(ae - as, be - bs));
  return Math.min(1, overlap / shorter);
}

export function isLikelyDuplicate(a: TripSpan, b: TripSpan, minOverlap = 0.6): boolean {
  if (overlapRatio(a, b) < minOverlap) return false;
  const big = Math.max(a.distanceKm, b.distanceKm);
  const small = Math.min(a.distanceKm, b.distanceKm);
  if (big < 0.5) return true; // both tiny
  return small / big >= 0.5;
}

export function findDuplicate<T extends TripSpan & Pick<Trip, 'id' | 'deletedAt' | 'confirmationStatus'>>(candidate: TripSpan, existing: T[]): T | null {
  for (const t of existing) {
    if (!isCountable(t)) continue;
    if (isLikelyDuplicate(candidate, t)) return t;
  }
  return null;
}
