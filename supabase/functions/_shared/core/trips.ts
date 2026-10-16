/**
 * Trip construction, validation and recalculation. Any change to distance, mode, variant or occupancy
 * produces a fresh calculation snapshot, so stored emissions always match the stored inputs.
 */
import { calculateEmissions, MAX_OCCUPANCY, toTripCalculation, validateDistance, type CalculationResult } from './calc.ts';
import type { Classification } from './classification.ts';
import type { DetectedTrip } from './detection.ts';
import { roundCoord } from './geo.ts';
import { MODE_INFO } from './modes.ts';
import type { FactorSet, PlaceRef, TransportMode, Trip } from './types.ts';
import { isTransportMode } from './types.ts';

export const MAX_TRIP_DURATION_H = 24;
export const MAX_LABEL_LENGTH = 120;
export const MAX_NOTES_LENGTH = 500;
/** Allowed clock skew when checking that a trip is not in the future. */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface TripInput {
  startedAt: string;
  endedAt: string;
  distanceKm: number;
  mode: TransportMode;
  variant?: string | null;
  occupancy?: number | null;
  origin?: PlaceRef | null;
  destination?: PlaceRef | null;
  notes?: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Typical upper average speeds used only for plausibility warnings (never to reject). */
const PLAUSIBLE_AVG_KMH: Partial<Record<TransportMode, number>> = { walking: 9, cycling: 35, bus: 90, metro: 90, motorcycle: 130, car: 150, taxi: 150, train: 160 };

export function validateTripInput(input: TripInput, now: Date = new Date()): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const s = Date.parse(input.startedAt);
  const e = Date.parse(input.endedAt);
  if (!Number.isFinite(s)) errors.push('Start time is invalid.');
  if (!Number.isFinite(e)) errors.push('End time is invalid.');
  if (Number.isFinite(s) && Number.isFinite(e)) {
    if (e < s) errors.push('End time must be after the start time.');
    if (e - s > MAX_TRIP_DURATION_H * 3_600_000) errors.push(`A single trip cannot last longer than ${MAX_TRIP_DURATION_H} hours.`);
    if (s > now.getTime() + FUTURE_TOLERANCE_MS) errors.push('Trips cannot start in the future.');
  }
  if (!isTransportMode(input.mode)) errors.push('Choose a valid transport mode.');
  errors.push(...validateDistance(input.distanceKm));
  if (input.occupancy != null && (!Number.isInteger(input.occupancy) || input.occupancy < 1 || input.occupancy > MAX_OCCUPANCY)) {
    errors.push(`Occupancy must be a whole number between 1 and ${MAX_OCCUPANCY}.`);
  }
  for (const [name, p] of [['Origin', input.origin], ['Destination', input.destination]] as const) {
    if (p?.label && p.label.length > MAX_LABEL_LENGTH) errors.push(`${name} must be at most ${MAX_LABEL_LENGTH} characters.`);
    if (p && (p.lat != null || p.lng != null)) {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) errors.push(`${name} coordinates are invalid.`);
    }
  }
  if (input.notes && input.notes.length > MAX_NOTES_LENGTH) errors.push(`Notes must be at most ${MAX_NOTES_LENGTH} characters.`);

  if (!errors.length && isTransportMode(input.mode) && e > s && input.distanceKm > 0) {
    const kmh = input.distanceKm / ((e - s) / 3_600_000);
    const max = PLAUSIBLE_AVG_KMH[input.mode];
    if (max && kmh > max) warnings.push(`Average speed of ${kmh.toFixed(0)} km/h is unusually high for ${MODE_INFO[input.mode].label.toLowerCase()}. Please check the distance and times.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function sanitizePlace(p: PlaceRef | null | undefined, keepPreciseCoords: boolean): PlaceRef | null {
  if (!p) return null;
  const label = p.label?.trim().slice(0, MAX_LABEL_LENGTH) || undefined;
  const hasCoords = typeof p.lat === 'number' && typeof p.lng === 'number';
  if (!label && !hasCoords) return null;
  return {
    label,
    lat: hasCoords ? (keepPreciseCoords ? p.lat : roundCoord(p.lat as number)) : undefined,
    lng: hasCoords ? (keepPreciseCoords ? p.lng : roundCoord(p.lng as number)) : undefined,
  };
}

export interface BuildContext {
  id: string;
  now: Date;
  set: FactorSet;
  keepPreciseCoords: boolean;
}

export function buildManualTrip(input: TripInput, ctx: BuildContext): { trip: Trip; calc: CalculationResult; validation: ValidationResult } {
  const validation = validateTripInput(input, ctx.now);
  if (!validation.ok) throw new TripValidationError(validation.errors);
  const calc = calculateEmissions({ distanceKm: input.distanceKm, mode: input.mode, variant: input.variant, occupancy: input.occupancy }, ctx.set);
  const nowIso = ctx.now.toISOString();
  const trip: Trip = {
    id: ctx.id,
    startedAt: new Date(input.startedAt).toISOString(),
    endedAt: new Date(input.endedAt).toISOString(),
    distanceKm: input.distanceKm,
    mode: input.mode,
    proposedMode: null,
    variant: calc.factor?.variant ?? input.variant ?? null,
    occupancy: MODE_INFO[input.mode].occupancyApplies ? input.occupancy ?? null : null,
    origin: sanitizePlace(input.origin, ctx.keepPreciseCoords),
    destination: sanitizePlace(input.destination, ctx.keepPreciseCoords),
    detectionSource: 'manual',
    classificationConfidence: null,
    confirmationStatus: 'confirmed',
    dedupeKey: null,
    notes: input.notes?.trim() || null,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
    ...toTripCalculation(calc, ctx.now),
  };
  return { trip, calc, validation };
}

export function buildAutoTrip(detected: DetectedTrip, classification: Classification, ctx: BuildContext & { defaultOccupancy: (m: TransportMode) => number | null }): Trip {
  const mode = classification.mode;
  const occupancy = MODE_INFO[mode].occupancyApplies ? ctx.defaultOccupancy(mode) : null;
  const calc = calculateEmissions({ distanceKm: detected.distanceKm, mode, occupancy }, ctx.set);
  const nowIso = ctx.now.toISOString();
  return {
    id: ctx.id,
    startedAt: detected.startedAt,
    endedAt: detected.endedAt,
    distanceKm: detected.distanceKm,
    mode,
    proposedMode: mode,
    variant: calc.factor?.variant ?? null,
    occupancy,
    origin: sanitizePlace({ lat: detected.start.lat, lng: detected.start.lng }, ctx.keepPreciseCoords),
    destination: sanitizePlace({ lat: detected.end.lat, lng: detected.end.lng }, ctx.keepPreciseCoords),
    detectionSource: 'auto',
    classificationConfidence: classification.confidence,
    confirmationStatus: classification.needsReview ? 'needs_review' : 'confirmed',
    dedupeKey: detected.dedupeKey,
    notes: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
    ...toTripCalculation(calc, ctx.now),
  };
}

export type TripPatch = Partial<Pick<Trip, 'startedAt' | 'endedAt' | 'distanceKm' | 'mode' | 'variant' | 'occupancy' | 'origin' | 'destination' | 'notes'>>;

/**
 * Applies a user edit and recalculates emissions. Auto-detected trips become `edited` (or `confirmed` if the
 * user only confirmed the proposed mode).
 */
export function applyTripEdit(trip: Trip, patch: TripPatch, ctx: Omit<BuildContext, 'id'>): { trip: Trip; calc: CalculationResult } {
  const modeChanged = patch.mode != null && patch.mode !== trip.mode;
  const next: TripInput = {
    startedAt: patch.startedAt ?? trip.startedAt,
    endedAt: patch.endedAt ?? trip.endedAt,
    distanceKm: patch.distanceKm ?? trip.distanceKm,
    mode: patch.mode ?? trip.mode,
    // A different mode invalidates the previous variant.
    variant: patch.variant !== undefined ? patch.variant : modeChanged ? null : trip.variant,
    occupancy: patch.occupancy !== undefined ? patch.occupancy : trip.occupancy,
    origin: patch.origin !== undefined ? patch.origin : trip.origin,
    destination: patch.destination !== undefined ? patch.destination : trip.destination,
    notes: patch.notes !== undefined ? patch.notes : trip.notes,
  };
  // Imported trips may keep historical start times; validate against the edit time.
  const validation = validateTripInput(next, ctx.now);
  if (!validation.ok) throw new TripValidationError(validation.errors);
  const occupancy = MODE_INFO[next.mode].occupancyApplies ? next.occupancy ?? null : null;
  const calc = calculateEmissions({ distanceKm: next.distanceKm, mode: next.mode, variant: next.variant, occupancy }, ctx.set);
  const changedSomething = Object.keys(patch).length > 0;
  let confirmationStatus = trip.confirmationStatus;
  if (trip.detectionSource === 'auto' && changedSomething) {
    confirmationStatus = modeChanged || patch.distanceKm != null || patch.startedAt != null || patch.endedAt != null ? 'edited' : 'confirmed';
  }
  if (trip.confirmationStatus === 'dismissed') confirmationStatus = 'dismissed';
  return {
    trip: {
      ...trip,
      startedAt: new Date(next.startedAt).toISOString(),
      endedAt: new Date(next.endedAt).toISOString(),
      distanceKm: next.distanceKm,
      mode: next.mode,
      variant: calc.factor?.variant ?? next.variant ?? null,
      occupancy,
      origin: next.origin !== trip.origin ? sanitizePlace(next.origin, ctx.keepPreciseCoords) : trip.origin,
      destination: next.destination !== trip.destination ? sanitizePlace(next.destination, ctx.keepPreciseCoords) : trip.destination,
      notes: next.notes?.trim() || null,
      confirmationStatus,
      updatedAt: ctx.now.toISOString(),
      ...toTripCalculation(calc, ctx.now),
    },
    calc,
  };
}

export function confirmTrip(trip: Trip, now: Date): Trip {
  return { ...trip, confirmationStatus: trip.confirmationStatus === 'edited' ? 'edited' : 'confirmed', updatedAt: now.toISOString() };
}

export function dismissTrip(trip: Trip, now: Date): Trip {
  return { ...trip, confirmationStatus: 'dismissed', updatedAt: now.toISOString() };
}

/** Recalculates a trip with a (possibly new) factor set, keeping all user inputs. */
export function recalculateTrip(trip: Trip, set: FactorSet, now: Date): Trip {
  const calc = calculateEmissions({ distanceKm: trip.distanceKm, mode: trip.mode, variant: trip.variant, occupancy: trip.occupancy }, set);
  return { ...trip, variant: calc.factor?.variant ?? null, updatedAt: now.toISOString(), ...toTripCalculation(calc, now) };
}

export class TripValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join(' '));
    this.errors = errors;
    this.name = 'TripValidationError';
  }
}
