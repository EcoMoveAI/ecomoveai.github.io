import { calculateEmissions, CALC_ENGINE_VERSION, formatKg, isCalculationStale, toTripCalculation, validateFactorUnit } from '@core/calc.ts';
import { DESNZ_SET, TW_SET } from '../helpers';

describe('calculateEmissions', () => {
  it('multiplies distance by a passenger-km factor (Taipei Metro 0.075 kg/pkm)', () => {
    const r = calculateEmissions({ distanceKm: 10, mode: 'metro' }, TW_SET);
    expect(r.status).toBe('calculated');
    expect(r.emissionsKg).toBeCloseTo(0.75, 10);
    expect(r.method).toBe('distance_x_pkm_factor');
    expect(r.factor?.id).toBe('twcfp-taipei-metro-2024-pkm');
    expect(r.factor?.boundary).toBe('lifecycle_product_cfp');
    expect(r.engineVersion).toBe(CALC_ENGINE_VERSION);
  });

  it('divides vehicle-km factors by occupancy', () => {
    const solo = calculateEmissions({ distanceKm: 12, mode: 'car', occupancy: 1 }, TW_SET);
    const shared = calculateEmissions({ distanceKm: 12, mode: 'car', occupancy: 3 }, TW_SET);
    expect(solo.emissionsKg).toBeCloseTo(12 * 0.16725, 10);
    expect(shared.emissionsKg).toBeCloseTo((12 * 0.16725) / 3, 10);
    expect(shared.method).toBe('distance_x_vkm_factor_div_occupancy');
    expect(shared.occupancyApplied).toBe(3);
  });

  it('assumes occupancy 1 with a warning when not given for vehicle-km factors', () => {
    const r = calculateEmissions({ distanceKm: 5, mode: 'motorcycle' }, TW_SET);
    expect(r.occupancyApplied).toBe(1);
    expect(r.emissionsKg).toBeCloseTo(5 * 0.11367, 10);
    expect(r.warnings.join(' ')).toMatch(/assumed 1/);
  });

  it('flags UK factors as regional proxies inside the Taiwan set', () => {
    const r = calculateEmissions({ distanceKm: 5, mode: 'taxi' }, TW_SET);
    expect(r.factor?.isRegionalProxy).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/proxy/);
    const uk = calculateEmissions({ distanceKm: 5, mode: 'taxi' }, DESNZ_SET);
    expect(uk.factor?.isRegionalProxy).toBe(false);
  });

  it('records walking and cycling as zero direct emissions with a lifecycle caveat', () => {
    const r = calculateEmissions({ distanceKm: 3, mode: 'cycling' }, TW_SET);
    expect(r.emissionsKg).toBe(0);
    expect(r.factor?.boundary).toBe('zero_direct_convention');
    expect(r.warnings.join(' ')).toMatch(/life-cycle emissions are not zero/);
  });

  it('returns factor_unavailable (not zero) for unknown or other public transport', () => {
    for (const mode of ['unknown', 'other_public'] as const) {
      const r = calculateEmissions({ distanceKm: 4, mode }, TW_SET);
      expect(r.status).toBe('factor_unavailable');
      expect(r.emissionsKg).toBeNull();
    }
  });

  it.each([
    [-1, /negative/],
    [Number.NaN, /finite/],
    [Number.POSITIVE_INFINITY, /finite/],
    [2000, /exceeds/],
  ])('rejects invalid distance %p', (d, msg) => {
    const r = calculateEmissions({ distanceKm: d, mode: 'bus' }, TW_SET);
    expect(r.status).toBe('invalid_input');
    expect(r.emissionsKg).toBeNull();
    expect(r.errors.join(' ')).toMatch(msg);
  });

  it('rejects invalid occupancy and unknown modes', () => {
    expect(calculateEmissions({ distanceKm: 1, mode: 'car', occupancy: 0 }, TW_SET).status).toBe('invalid_input');
    expect(calculateEmissions({ distanceKm: 1, mode: 'car', occupancy: 2.5 }, TW_SET).status).toBe('invalid_input');
    expect(calculateEmissions({ distanceKm: 1, mode: 'rocket' as never }, TW_SET).status).toBe('invalid_input');
  });

  it('accepts zero distance', () => {
    const r = calculateEmissions({ distanceKm: 0, mode: 'bus' }, TW_SET);
    expect(r.status).toBe('calculated');
    expect(r.emissionsKg).toBe(0);
  });

  it('uses explicit variants and falls back to the default variant when a variant is not in the set', () => {
    const tc = calculateEmissions({ distanceKm: 100, mode: 'train', variant: 'tra_tze_chiang' }, TW_SET);
    expect(tc.emissionsKg).toBeCloseTo(3.6, 10);
    const fallback = calculateEmissions({ distanceKm: 100, mode: 'train', variant: 'tra_tze_chiang' }, DESNZ_SET);
    expect(fallback.status).toBe('calculated');
    expect(fallback.factor?.variant).toBe('national_rail');
    expect(fallback.warnings.join(' ')).toMatch(/not in/);
  });

  it('keeps full precision internally and rounds only for display', () => {
    const r = calculateEmissions({ distanceKm: 1.234567, mode: 'taxi' }, TW_SET);
    expect(r.emissionsKg).toBe(1.234567 * 0.14861);
    expect(formatKg(r.emissionsKg)).toBe('183 g');
    expect(formatKg(12.3456)).toBe('12.35 kg');
    expect(formatKg(1234.5)).toBe('1,235 kg');
    expect(formatKg(null)).toBe('—');
  });
});

describe('calculation snapshots', () => {
  it('stores factor id, value, unit, set version and engine version for reproducibility', () => {
    const r = calculateEmissions({ distanceKm: 8, mode: 'bus' }, TW_SET);
    const snap = toTripCalculation(r, new Date('2026-10-01T00:00:00Z'));
    expect(snap).toMatchObject({
      calcStatus: 'calculated',
      factorId: 'desnz25-bus-average-local-pkm',
      factorValue: 0.10385,
      factorUnit: 'kgCO2e/pkm',
      factorSetId: TW_SET.id,
      factorSetVersion: TW_SET.version,
      calcEngineVersion: CALC_ENGINE_VERSION,
      calculatedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(isCalculationStale(snap, TW_SET)).toBe(false);
    expect(isCalculationStale(snap, DESNZ_SET)).toBe(true);
    expect(isCalculationStale({ ...snap, factorSetVersion: 'old' }, TW_SET)).toBe(true);
  });

  it('validates factor units', () => {
    expect(validateFactorUnit('kgCO2e/pkm')).toBe(true);
    expect(validateFactorUnit('kgCO2e/vkm')).toBe(true);
    expect(validateFactorUnit('gCO2e/pkm')).toBe(false);
    expect(validateFactorUnit('kgCO2e/mile')).toBe(false);
  });
});
