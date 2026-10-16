import { validateFactorUnit } from '@core/calc.ts';
import { allFactors, boundariesComparable, FACTOR_SETS, findFactor, getFactorSetOrDefault } from '@core/factors.ts';
import { TRANSPORT_MODES } from '@core/types.ts';

describe('emission-factor datasets', () => {
  const factors = allFactors();

  it('every factor has a traceable source, valid unit and non-negative value', () => {
    for (const f of factors) {
      expect(f.sourceUrl).toMatch(/^https:\/\//);
      expect(f.sourceOrg.length).toBeGreaterThan(3);
      expect(f.methodologyNotes.length).toBeGreaterThan(20);
      expect(validateFactorUnit(f.unit)).toBe(true);
      expect(Number.isFinite(f.value) && f.value >= 0).toBe(true);
      expect(f.gasMetric).toBe('CO2e');
    }
  });

  it('non-convention factors cite a row, certificate or reference', () => {
    for (const f of factors.filter((x) => x.quality !== 'convention')) {
      expect(f.sourceReference).toBeTruthy();
    }
  });

  it('factor ids are unique', () => {
    expect(new Set(factors.map((f) => f.id)).size).toBe(factors.length);
  });

  it('pins the verified values (changing a value requires a new factor id)', () => {
    const byId = Object.fromEntries(factors.map((f) => [f.id, f.value]));
    expect(byId).toMatchObject({
      'twcfp-taipei-metro-2024-pkm': 0.075,
      'twcfp-thsr-2025-pkm': 0.029,
      'twcfp-tra-local-2025-pkm': 0.055,
      'twcfp-tra-tzechiang-2025-pkm': 0.036,
      'twcfp-tra-chukuang-2025-pkm': 0.05,
      'desnz25-car-average-unknown-vkm': 0.16725,
      'desnz25-car-average-petrol-vkm': 0.16272,
      'desnz25-car-average-bev-vkm': 0.04047,
      'desnz25-motorbike-average-vkm': 0.11367,
      'desnz25-taxi-regular-pkm': 0.14861,
      'desnz25-bus-average-local-pkm': 0.10385,
      'desnz25-bus-coach-pkm': 0.02776,
      'desnz25-rail-national-pkm': 0.03546,
      'desnz25-rail-underground-pkm': 0.0278,
      'desnz25-rail-lightrail-pkm': 0.0286,
    });
  });

  it('each set has a default variant that resolves for every mode with factors', () => {
    for (const set of FACTOR_SETS) {
      for (const [mode, variant] of Object.entries(set.defaultVariants)) {
        expect(findFactor(set, mode as never, variant)).toBeDefined();
      }
      // Within one set, a (mode, variant) pair is unique.
      const keys = set.factors.map((f) => `${f.mode}:${f.variant}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('declares no factor for unknown / other public transport (explicitly unavailable)', () => {
    for (const set of FACTOR_SETS) {
      expect(findFactor(set, 'unknown')).toBeUndefined();
      expect(findFactor(set, 'other_public')).toBeUndefined();
      const covered = TRANSPORT_MODES.filter((m) => findFactor(set, m));
      expect(covered.length).toBe(TRANSPORT_MODES.length - 2);
    }
  });

  it('marks the Taiwan-first set as mixed-boundary and the DESNZ set as consistent', () => {
    const tw = getFactorSetOrDefault('ecomove-tw-hybrid');
    const uk = getFactorSetOrDefault('desnz-2025-uk');
    expect(tw.mixedBoundaries).toBe(true);
    expect(boundariesComparable(tw.factors.map((f) => f.boundary))).toBe(false);
    expect(uk.mixedBoundaries).toBe(false);
    expect(boundariesComparable(uk.factors.map((f) => f.boundary))).toBe(true);
  });

  it('falls back to the default set for unknown ids', () => {
    expect(getFactorSetOrDefault('nope').id).toBe('ecomove-tw-hybrid');
    expect(getFactorSetOrDefault(null).id).toBe('ecomove-tw-hybrid');
  });
});
