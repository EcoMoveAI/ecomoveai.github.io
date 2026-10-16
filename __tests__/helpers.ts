import { calculateEmissions, toTripCalculation } from '@core/calc.ts';
import { getFactorSetOrDefault } from '@core/factors.ts';
import type { FactorSet, TransportMode, Trip } from '@core/types.ts';

let seq = 0;

export const TW_SET = getFactorSetOrDefault('ecomove-tw-hybrid');
export const DESNZ_SET = getFactorSetOrDefault('desnz-2025-uk');

/** Creates a trip with a real calculation snapshot. `startedAt` is an ISO instant. */
export function makeTrip(
  startedAt: string,
  mode: TransportMode,
  distanceKm: number,
  overrides: Partial<Trip> = {},
  set: FactorSet = TW_SET,
): Trip {
  seq += 1;
  const start = new Date(startedAt);
  const end = new Date(start.getTime() + 20 * 60000);
  const calc = calculateEmissions({ distanceKm, mode, occupancy: overrides.occupancy ?? null, variant: overrides.variant ?? null }, set);
  return {
    id: `trip-${seq}`,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    distanceKm,
    mode,
    proposedMode: null,
    variant: calc.factor?.variant ?? null,
    occupancy: null,
    origin: null,
    destination: null,
    detectionSource: 'manual',
    classificationConfidence: null,
    confirmationStatus: 'confirmed',
    dedupeKey: null,
    notes: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
    ...toTripCalculation(calc, start),
    ...overrides,
  };
}
