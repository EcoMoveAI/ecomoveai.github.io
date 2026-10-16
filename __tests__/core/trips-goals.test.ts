import { CALC_ENGINE_VERSION } from '@core/calc.ts';
import { evaluateGoal, validateGoal, type Goal } from '@core/goals.ts';
import { applyTripEdit, buildAutoTrip, buildManualTrip, dismissTrip, recalculateTrip, TripValidationError, validateTripInput } from '@core/trips.ts';
import { DESNZ_SET, makeTrip, TW_SET } from '../helpers';

const NOW = new Date('2026-10-10T04:00:00Z');
const ctx = { id: 'id-1', now: NOW, set: TW_SET, keepPreciseCoords: false };

describe('manual trips', () => {
  it('builds a confirmed manual trip with a calculation snapshot and coarsened coordinates', () => {
    const { trip } = buildManualTrip(
      { startedAt: '2026-10-10T01:00:00Z', endedAt: '2026-10-10T01:25:00Z', distanceKm: 8, mode: 'metro', origin: { label: ' Home ', lat: 25.033964, lng: 121.564468 }, destination: { label: 'NTU' } },
      ctx,
    );
    expect(trip).toMatchObject({ detectionSource: 'manual', confirmationStatus: 'confirmed', calcStatus: 'calculated', factorId: 'twcfp-taipei-metro-2024-pkm', calcEngineVersion: CALC_ENGINE_VERSION });
    expect(trip.emissionsKg).toBeCloseTo(0.6);
    expect(trip.origin).toEqual({ label: 'Home', lat: 25.034, lng: 121.564 });
  });

  it('rejects invalid trips', () => {
    const base = { startedAt: '2026-10-10T01:00:00Z', endedAt: '2026-10-10T01:25:00Z', distanceKm: 8, mode: 'bus' as const };
    expect(validateTripInput({ ...base, distanceKm: -3 }, NOW).ok).toBe(false);
    expect(validateTripInput({ ...base, endedAt: '2026-10-10T00:00:00Z' }, NOW).errors.join(' ')).toMatch(/after the start/);
    expect(validateTripInput({ ...base, startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T01:00:00Z' }, NOW).errors.join(' ')).toMatch(/future/);
    expect(validateTripInput({ ...base, endedAt: '2026-10-12T01:00:00Z' }, NOW).ok).toBe(false);
    expect(validateTripInput({ ...base, mode: 'teleport' as never }, NOW).ok).toBe(false);
    expect(validateTripInput({ ...base, origin: { label: 'x'.repeat(121) } }, NOW).ok).toBe(false);
    expect(() => buildManualTrip({ ...base, distanceKm: Number.NaN }, ctx)).toThrow(TripValidationError);
  });

  it('warns (without rejecting) about implausible speeds', () => {
    const v = validateTripInput({ startedAt: '2026-10-10T01:00:00Z', endedAt: '2026-10-10T01:10:00Z', distanceKm: 20, mode: 'walking' }, NOW);
    expect(v.ok).toBe(true);
    expect(v.warnings[0]).toMatch(/unusually high/);
  });
});

describe('editing and recalculation', () => {
  const detected = {
    startedAt: '2026-10-10T01:00:00.000Z', endedAt: '2026-10-10T01:30:00.000Z', start: { lat: 25.04, lng: 121.5 }, end: { lat: 25.1, lng: 121.5 },
    distanceKm: 7, durationS: 1800, endReason: 'stationary' as const, dedupeKey: 'auto:1',
    features: { distanceKm: 7, durationS: 1800, avgSpeedKmh: 14, p85SpeedKmh: 30, maxSpeedKmh: 45, stopCount: 3, sampleCount: 60, meanAccuracyM: 10 },
  };
  const auto = buildAutoTrip(detected, { mode: 'car', confidence: 0.3, candidates: [], reasons: [], needsReview: true }, { ...ctx, defaultOccupancy: () => 1 });

  it('creates auto trips that need review', () => {
    expect(auto).toMatchObject({ detectionSource: 'auto', confirmationStatus: 'needs_review', proposedMode: 'car', dedupeKey: 'auto:1' });
  });

  it('recalculates emissions when the user corrects the mode and marks the trip edited', () => {
    const later = new Date('2026-10-10T05:00:00Z');
    const { trip } = applyTripEdit(auto, { mode: 'bus' }, { now: later, set: TW_SET, keepPreciseCoords: false });
    expect(trip.mode).toBe('bus');
    expect(trip.confirmationStatus).toBe('edited');
    expect(trip.emissionsKg).toBeCloseTo(7 * 0.10385);
    expect(trip.factorId).toBe('desnz25-bus-average-local-pkm');
    expect(trip.occupancy).toBeNull();
    expect(trip.updatedAt).toBe(later.toISOString());
    expect(trip.proposedMode).toBe('car');
  });

  it('confirms without changes when only occupancy is set', () => {
    const { trip } = applyTripEdit(auto, { occupancy: 2 }, { now: NOW, set: TW_SET, keepPreciseCoords: false });
    expect(trip.confirmationStatus).toBe('confirmed');
    expect(trip.emissionsKg).toBeCloseTo((7 * 0.16725) / 2);
  });

  it('recalculates historic trips with a new factor set and keeps user inputs', () => {
    const t = makeTrip('2026-10-01T01:00:00Z', 'metro', 10);
    const r = recalculateTrip(t, DESNZ_SET, NOW);
    expect(r.factorSetId).toBe(DESNZ_SET.id);
    expect(r.emissionsKg).toBeCloseTo(0.278);
    expect(r.distanceKm).toBe(10);
  });

  it('dismissed trips stay dismissed', () => {
    const d = dismissTrip(auto, NOW);
    expect(d.confirmationStatus).toBe('dismissed');
    expect(applyTripEdit(d, { mode: 'bus' }, { now: NOW, set: TW_SET, keepPreciseCoords: false }).trip.confirmationStatus).toBe('dismissed');
  });
});

describe('goals', () => {
  const goal = (type: Goal['type'], targetValue: number): Goal => ({ id: 'g', type, targetValue, period: 'month', status: 'active', createdAt: '', updatedAt: '', deletedAt: null });

  it('validates goal targets', () => {
    expect(validateGoal({ type: 'reduce_emissions_pct', targetValue: 10, period: 'month' })).toEqual([]);
    expect(validateGoal({ type: 'reduce_emissions_pct', targetValue: 0, period: 'month' })).toHaveLength(1);
    expect(validateGoal({ type: 'max_taxi_trips', targetValue: 2.5, period: 'week' })).toHaveLength(1);
  });

  it('reports insufficient data instead of inventing a baseline', () => {
    const p = evaluateGoal(goal('reduce_emissions_pct', 10), [makeTrip('2026-10-02T01:00:00Z', 'car', 10)], NOW, 'Asia/Taipei');
    expect(p.status).toBe('insufficient_data');
    expect(p.baselineKg).toBeNull();
  });

  it('projects emission-goal progress against a personal baseline', () => {
    const trips = [
      makeTrip('2026-09-05T01:00:00Z', 'car', 100), // Sep baseline 16.725
      makeTrip('2026-10-02T01:00:00Z', 'car', 10), // 1.6725 so far
    ];
    const p = evaluateGoal(goal('reduce_emissions_pct', 10), trips, NOW, 'Asia/Taipei');
    expect(p.baselineKg).toBeCloseTo(16.725);
    expect(p.status).toBe('on_track');
    expect(p.disclaimer).toMatch(/not a scientific/);
  });

  it('counts trips for trip-based goals without judgemental wording', () => {
    const trips = [makeTrip('2026-10-02T01:00:00Z', 'taxi', 3), makeTrip('2026-10-03T01:00:00Z', 'taxi', 3), makeTrip('2026-10-04T01:00:00Z', 'taxi', 3)];
    const p = evaluateGoal(goal('max_taxi_trips', 2), trips, NOW, 'Asia/Taipei');
    expect(p.current).toBe(3);
    expect(p.status).toBe('at_risk');
    expect(p.message).toMatch(/necessary/);
    const pt = evaluateGoal(goal('min_public_transport_trips', 1), [makeTrip('2026-10-02T01:00:00Z', 'metro', 3)], NOW, 'Asia/Taipei');
    expect(pt.status).toBe('achieved');
  });
});
