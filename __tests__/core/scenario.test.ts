import { compareModesForDistance, simulateModeShift, validateScenario } from '@core/scenario.ts';
import { DEFAULT_PREFERENCES } from '@core/types.ts';
import { makeTrip, TW_SET } from '../helpers';

const window = { start: '2026-09-10T00:00:00Z', end: '2026-10-10T00:00:00Z' };

describe('simulateModeShift', () => {
  const trips = [
    makeTrip('2026-09-15T01:00:00Z', 'taxi', 6, { destination: { label: 'NTU campus' } }),
    makeTrip('2026-09-22T01:00:00Z', 'taxi', 6, { destination: { label: 'NTU Campus' } }),
    makeTrip('2026-09-25T01:00:00Z', 'taxi', 20, { destination: { label: 'Airport' } }),
    makeTrip('2026-09-26T01:00:00Z', 'metro', 6),
  ];

  it('estimates the effect of replacing matching taxi trips with MRT without modifying history', () => {
    const snapshot = JSON.stringify(trips);
    const r = simulateModeShift(trips, { fromModes: ['taxi'], toMode: 'metro', shareReplaced: 1, baselineWindow: window, placeFilter: 'campus' }, TW_SET, DEFAULT_PREFERENCES);
    expect(r.valueType).toBe('simulated');
    expect(r.matchedTrips).toBe(2);
    expect(r.baselineKg).toBeCloseTo(12 * 0.14861, 10);
    expect(r.alternativeKg).toBeCloseTo(12 * 0.075, 10);
    expect(r.deltaKg).toBeCloseTo(12 * (0.075 - 0.14861), 10);
    expect(r.projectedMonthlyDeltaKg).toBeCloseTo(r.deltaKg, 10); // 30-day window
    expect(r.assumptions.join(' ')).toMatch(/campus/);
    expect(JSON.stringify(trips)).toBe(snapshot);
  });

  it('applies share, distance multiplier and max distance', () => {
    const r = simulateModeShift(trips, { fromModes: ['taxi'], toMode: 'bus', shareReplaced: 0.5, baselineWindow: window, maxTripKm: 10, distanceMultiplier: 1.2 }, TW_SET, DEFAULT_PREFERENCES);
    expect(r.matchedTrips).toBe(2);
    expect(r.baselineKg).toBeCloseTo(0.5 * 12 * 0.14861, 10);
    expect(r.alternativeKg).toBeCloseTo(0.5 * 12 * 1.2 * 0.10385, 10);
  });

  it('warns when nothing matches and returns zero change', () => {
    const r = simulateModeShift(trips, { fromModes: ['car'], toMode: 'metro', shareReplaced: 1, baselineWindow: window }, TW_SET, DEFAULT_PREFERENCES);
    expect(r.matchedTrips).toBe(0);
    expect(r.deltaKg).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/No recorded trips match/);
  });

  it('validates inputs', () => {
    expect(validateScenario({ fromModes: [], toMode: 'bus', shareReplaced: 2, baselineWindow: { start: 'x', end: 'y' } })).toHaveLength(3);
    expect(validateScenario({ fromModes: ['bus'], toMode: 'bus', shareReplaced: 1, baselineWindow: window })).toEqual(['toMode must differ from the replaced modes.']);
  });
});

describe('compareModesForDistance', () => {
  it('ranks modes by estimated emissions and lists unavailable ones last', () => {
    const c = compareModesForDistance(10, ['car', 'metro', 'walking', 'unknown', 'taxi'], TW_SET, { defaultCarOccupancy: 2, defaultMotorcycleOccupancy: 1 });
    expect(c.valueType).toBe('estimate');
    expect(c.rows.map((r) => r.mode)).toEqual(['walking', 'metro', 'car', 'taxi', 'unknown']);
    expect(c.rows.find((r) => r.mode === 'car')?.emissionsKg).toBeCloseTo((10 * 0.16725) / 2);
    expect(c.rows[c.rows.length - 1].status).toBe('factor_unavailable');
    expect(c.notes.join(' ')).toMatch(/MIXED ACCOUNTING BOUNDARIES/);
  });
});
