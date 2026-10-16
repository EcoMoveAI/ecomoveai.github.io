/**
 * Deterministic carbon calculation engine.
 *
 *   emissions (kg CO2e) = distance (km) × factor (kg CO2e / passenger-km)
 *   emissions (kg CO2e) = distance (km) × factor (kg CO2e / vehicle-km) ÷ occupants
 *
 * The LLM never computes emissions; it calls this module through agent tools.
 */
import { findFactor } from './factors.ts';
import { MODE_INFO } from './modes.ts';
import type {
  AccountingBoundary,
  CalcStatus,
  EmissionFactor,
  FactorSet,
  FactorUnit,
  TransportMode,
  TripCalculation,
} from './types.ts';
import { isTransportMode } from './types.ts';

export const CALC_ENGINE_VERSION = 'calc-1.0.0';

/** Upper bound for a single everyday ground trip. Longer inputs are rejected as likely errors. */
export const MAX_TRIP_DISTANCE_KM = 1500;
export const MAX_OCCUPANCY = 9;

export interface CalculationInput {
  distanceKm: number;
  mode: TransportMode;
  variant?: string | null;
  /** Total people in the vehicle including the user. Only used with vehicle-km factors. */
  occupancy?: number | null;
}

export interface CalculationResult {
  status: CalcStatus;
  /** Full precision. Round only for display. */
  emissionsKg: number | null;
  distanceKm: number;
  mode: TransportMode;
  factor: EmissionFactor | null;
  factorSetId: string;
  factorSetVersion: string;
  occupancyApplied: number | null;
  method: CalcMethod | 'none';
  /** Human-readable formula with the numbers used. */
  formula: string;
  warnings: string[];
  errors: string[];
  engineVersion: string;
}

export type CalcMethod = 'distance_x_pkm_factor' | 'distance_x_vkm_factor_div_occupancy';

export function validateDistance(distanceKm: unknown): string[] {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm)) return ['Distance must be a finite number of kilometres.'];
  if (distanceKm < 0) return ['Distance cannot be negative.'];
  if (distanceKm > MAX_TRIP_DISTANCE_KM) return [`Distance exceeds ${MAX_TRIP_DISTANCE_KM} km; long-distance flights and voyages are not supported.`];
  return [];
}

export function validateFactorUnit(unit: unknown): unit is FactorUnit {
  return unit === 'kgCO2e/pkm' || unit === 'kgCO2e/vkm';
}

export function calculateEmissions(input: CalculationInput, set: FactorSet): CalculationResult {
  const base = {
    distanceKm: input.distanceKm,
    mode: input.mode,
    factorSetId: set.id,
    factorSetVersion: set.version,
    engineVersion: CALC_ENGINE_VERSION,
  };
  const errors: string[] = [];
  if (!isTransportMode(input.mode)) errors.push(`Unknown transport mode "${String(input.mode)}".`);
  errors.push(...validateDistance(input.distanceKm));
  if (input.occupancy != null) {
    if (!Number.isInteger(input.occupancy) || input.occupancy < 1 || input.occupancy > MAX_OCCUPANCY) {
      errors.push(`Occupancy must be a whole number between 1 and ${MAX_OCCUPANCY}.`);
    }
  }
  if (errors.length) {
    return { ...base, status: 'invalid_input', emissionsKg: null, factor: null, occupancyApplied: null, method: 'none', formula: '', warnings: [], errors };
  }

  const fallbackWarnings: string[] = [];
  let factor = findFactor(set, input.mode, input.variant);
  if (!factor && input.variant) {
    // The variant may belong to another factor set (e.g. after switching methodology); use the set's default.
    factor = findFactor(set, input.mode, null);
    if (factor) fallbackWarnings.push(`Variant "${input.variant}" is not in "${set.shortName}"; the default ${factor.variantLabel} factor was used.`);
  }
  if (!factor) {
    const variantNote = input.variant ? ` (variant "${input.variant}")` : '';
    return {
      ...base, status: 'factor_unavailable', emissionsKg: null, factor: null, occupancyApplied: null, method: 'none', formula: '',
      warnings: [`No emission factor is available for ${MODE_INFO[input.mode].label}${variantNote} in "${set.shortName}". The trip is saved but excluded from emission totals.`],
      errors: [],
    };
  }
  if (!validateFactorUnit(factor.unit) || !Number.isFinite(factor.value) || factor.value < 0) {
    return { ...base, status: 'invalid_input', emissionsKg: null, factor, occupancyApplied: null, method: 'none', formula: '', warnings: [], errors: [`Factor ${factor.id} has an invalid unit or value.`] };
  }

  const warnings: string[] = [...fallbackWarnings];
  let emissionsKg: number;
  let method: CalcMethod;
  let occupancyApplied: number | null = null;
  let formula: string;

  if (factor.unit === 'kgCO2e/vkm') {
    occupancyApplied = input.occupancy ?? 1;
    if (input.occupancy == null) warnings.push('Occupancy not given; assumed 1 person (the driver/rider only).');
    emissionsKg = (input.distanceKm * factor.value) / occupancyApplied;
    method = 'distance_x_vkm_factor_div_occupancy';
    formula = `${fmt(input.distanceKm)} km × ${factor.value} kg CO2e/vehicle-km ÷ ${occupancyApplied} occupant(s) = ${fmt(emissionsKg, 4)} kg CO2e`;
  } else {
    if (input.occupancy != null && input.occupancy !== 1 && MODE_INFO[input.mode].occupancyApplies) {
      warnings.push('Occupancy ignored: this factor is already per passenger-km.');
    }
    emissionsKg = input.distanceKm * factor.value;
    method = 'distance_x_pkm_factor';
    formula = `${fmt(input.distanceKm)} km × ${factor.value} kg CO2e/passenger-km = ${fmt(emissionsKg, 4)} kg CO2e`;
  }

  if (factor.isRegionalProxy) warnings.push(`Factor is a ${factor.region} value used as a proxy for ${set.primaryRegion}.`);
  if (factor.boundary === 'zero_direct_convention') warnings.push('Zero direct operational emissions; life-cycle emissions are not zero.');

  return { ...base, status: 'calculated', emissionsKg, factor, occupancyApplied, method, formula, warnings, errors: [] };
}

/** Converts a calculation result into the snapshot persisted with a trip. */
export function toTripCalculation(r: CalculationResult, now: Date = new Date()): TripCalculation {
  return {
    calcStatus: r.status,
    emissionsKg: r.emissionsKg,
    factorId: r.factor?.id ?? null,
    factorValue: r.factor?.value ?? null,
    factorUnit: r.factor?.unit ?? null,
    factorSetId: r.factorSetId,
    factorSetVersion: r.factorSetVersion,
    boundary: (r.factor?.boundary ?? null) as AccountingBoundary | null,
    calcMethod: r.method,
    calcEngineVersion: r.engineVersion,
    occupancyApplied: r.occupancyApplied,
    calculatedAt: now.toISOString(),
  };
}

/** True when a stored calculation was made with a different factor set/version than the given set. */
export function isCalculationStale(calc: Pick<TripCalculation, 'factorSetId' | 'factorSetVersion' | 'calcEngineVersion'>, set: FactorSet): boolean {
  return calc.factorSetId !== set.id || calc.factorSetVersion !== set.version || calc.calcEngineVersion !== CALC_ENGINE_VERSION;
}

function fmt(n: number, digits = 2): string {
  return Number(n.toFixed(digits)).toString();
}

/** Display rounding for kg CO2e. Internally values keep full precision. */
export function formatKg(kg: number | null | undefined): string {
  if (kg == null || !Number.isFinite(kg)) return '—';
  const abs = Math.abs(kg);
  if (abs === 0) return '0 kg';
  if (abs < 1) return `${Math.round(kg * 1000)} g`;
  if (abs < 100) return `${kg.toFixed(2)} kg`;
  return `${Math.round(kg).toLocaleString('en-US')} kg`;
}

export function formatKm(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return '—';
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}
