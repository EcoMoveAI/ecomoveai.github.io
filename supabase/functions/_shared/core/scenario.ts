/**
 * Scenario simulation and mode comparison. Pure functions: they read trips and never modify them.
 * All outputs are labelled `simulated` or `estimate` so they cannot be confused with recorded emissions.
 */
import { calculateEmissions, type CalculationResult } from './calc.ts';
import { tripsInWindow } from './analytics.ts';
import { findFactor } from './factors.ts';
import { MODE_INFO } from './modes.ts';
import type { TimeWindow } from './time.ts';
import type { FactorSet, TransportMode, Trip, UserPreferences } from './types.ts';

export interface ModeComparisonRow {
  mode: TransportMode;
  variant: string | null;
  variantLabel: string | null;
  status: CalculationResult['status'];
  emissionsKg: number | null;
  factorId: string | null;
  boundary: string | null;
  formula: string;
  warnings: string[];
}

export interface ModeComparison {
  valueType: 'estimate';
  distanceKm: number;
  factorSetId: string;
  factorSetVersion: string;
  rows: ModeComparisonRow[];
  notes: string[];
}

export function compareModesForDistance(
  distanceKm: number,
  modes: TransportMode[],
  set: FactorSet,
  prefs: Pick<UserPreferences, 'defaultCarOccupancy' | 'defaultMotorcycleOccupancy'>,
): ModeComparison {
  const rows: ModeComparisonRow[] = [...new Set(modes)].map((mode) => {
    const occupancy = mode === 'car' ? prefs.defaultCarOccupancy : mode === 'motorcycle' ? prefs.defaultMotorcycleOccupancy : null;
    const r = calculateEmissions({ distanceKm, mode, occupancy }, set);
    return {
      mode,
      variant: r.factor?.variant ?? null,
      variantLabel: r.factor?.variantLabel ?? null,
      status: r.status,
      emissionsKg: r.emissionsKg,
      factorId: r.factor?.id ?? null,
      boundary: r.factor?.boundary ?? null,
      formula: r.formula,
      warnings: [...r.warnings, ...r.errors],
    };
  });
  rows.sort((a, b) => (a.emissionsKg ?? Infinity) - (b.emissionsKg ?? Infinity));
  const notes = [
    'Estimates use the same distance for every mode; real routes differ (public transport and walking routes are often longer or shorter than the road route).',
  ];
  if (set.mixedBoundaries) notes.push(...set.caveats.slice(0, 1));
  return { valueType: 'estimate', distanceKm, factorSetId: set.id, factorSetVersion: set.version, rows, notes };
}

export interface ModeShiftScenarioInput {
  /** Recorded modes whose trips would be replaced. */
  fromModes: TransportMode[];
  toMode: TransportMode;
  toVariant?: string | null;
  /** Fraction (0–1) of matching trips assumed to switch. */
  shareReplaced: number;
  /** Historical window whose trips define the baseline travel pattern. */
  baselineWindow: TimeWindow;
  /** Only trips at or below this distance are considered replaceable (optional). */
  maxTripKm?: number | null;
  /** Ratio of the alternative route distance to the recorded distance (default 1.0). */
  distanceMultiplier?: number | null;
  /** Optional filter on origin/destination labels (case-insensitive substring), e.g. "campus". */
  placeFilter?: string | null;
}

export interface ModeShiftScenarioResult {
  valueType: 'simulated';
  matchedTrips: number;
  matchedDistanceKm: number;
  baselineKg: number;
  alternativeKg: number;
  /** alternativeKg − baselineKg (negative = reduction). */
  deltaKg: number;
  deltaPctOfMatched: number | null;
  /** deltaKg scaled to a 30-day month based on the baseline window length. */
  projectedMonthlyDeltaKg: number;
  baselineWindowDays: number;
  unavailableTrips: number;
  assumptions: string[];
  warnings: string[];
}

export function validateScenario(input: ModeShiftScenarioInput): string[] {
  const errors: string[] = [];
  if (!Array.isArray(input.fromModes) || input.fromModes.length === 0) errors.push('fromModes must list at least one mode.');
  if (!(input.shareReplaced >= 0 && input.shareReplaced <= 1)) errors.push('shareReplaced must be between 0 and 1.');
  if (input.distanceMultiplier != null && !(input.distanceMultiplier > 0 && input.distanceMultiplier <= 5)) errors.push('distanceMultiplier must be between 0 and 5.');
  if (input.maxTripKm != null && !(input.maxTripKm > 0)) errors.push('maxTripKm must be positive.');
  const s = Date.parse(input.baselineWindow?.start);
  const e = Date.parse(input.baselineWindow?.end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) errors.push('baselineWindow must have a valid start before end.');
  if (input.fromModes?.includes(input.toMode)) errors.push('toMode must differ from the replaced modes.');
  return errors;
}

export function simulateModeShift(
  trips: Trip[],
  input: ModeShiftScenarioInput,
  set: FactorSet,
  prefs: Pick<UserPreferences, 'defaultCarOccupancy' | 'defaultMotorcycleOccupancy'>,
): ModeShiftScenarioResult {
  const errors = validateScenario(input);
  if (errors.length) throw new Error(errors.join(' '));
  const mult = input.distanceMultiplier ?? 1;
  const filter = input.placeFilter?.trim().toLowerCase() || null;
  const matched = tripsInWindow(trips, input.baselineWindow).filter(
    (t) =>
      input.fromModes.includes(t.mode) &&
      (input.maxTripKm == null || t.distanceKm <= input.maxTripKm) &&
      (!filter || `${t.origin?.label ?? ''} ${t.destination?.label ?? ''}`.toLowerCase().includes(filter)),
  );

  let baselineKg = 0;
  let alternativeKg = 0;
  let unavailable = 0;
  let distance = 0;
  const altOccupancy = input.toMode === 'car' ? prefs.defaultCarOccupancy : input.toMode === 'motorcycle' ? prefs.defaultMotorcycleOccupancy : null;
  for (const t of matched) {
    // Recalculate the baseline with the current factor set so both sides use identical methodology.
    const base = calculateEmissions({ distanceKm: t.distanceKm, mode: t.mode, variant: t.variant, occupancy: t.occupancy }, set);
    const alt = calculateEmissions({ distanceKm: t.distanceKm * mult, mode: input.toMode, variant: input.toVariant, occupancy: altOccupancy }, set);
    if (base.emissionsKg == null || alt.emissionsKg == null) {
      unavailable += 1;
      continue;
    }
    distance += t.distanceKm;
    baselineKg += base.emissionsKg * input.shareReplaced;
    alternativeKg += alt.emissionsKg * input.shareReplaced;
  }
  const windowDays = (Date.parse(input.baselineWindow.end) - Date.parse(input.baselineWindow.start)) / 86400000;
  const deltaKg = alternativeKg - baselineKg;
  const toFactor = findFactor(set, input.toMode, input.toVariant);

  const assumptions = [
    `Baseline pattern: your recorded ${input.fromModes.map((m) => MODE_INFO[m].label).join(', ')} trips between ${input.baselineWindow.start.slice(0, 10)} and ${input.baselineWindow.end.slice(0, 10)}${filter ? ` matching "${input.placeFilter}"` : ''}${input.maxTripKm ? ` of ≤ ${input.maxTripKm} km` : ''}.`,
    `${Math.round(input.shareReplaced * 100)}% of those trips are assumed to switch to ${MODE_INFO[input.toMode].label}${toFactor ? ` (${toFactor.variantLabel})` : ''}.`,
    `Alternative route distance = recorded distance × ${mult}.`,
    'Future travel is assumed to follow the same frequency as the baseline window; the monthly projection scales linearly to 30 days.',
    `Both sides use factor set "${set.shortName}" v${set.version}.`,
  ];
  const warnings: string[] = [];
  if (matched.length === 0) warnings.push('No recorded trips match this scenario, so the simulated change is zero.');
  if (unavailable) warnings.push(`${unavailable} matching trip(s) were skipped because an emission factor is unavailable.`);
  if (!toFactor) warnings.push(`No emission factor is available for ${MODE_INFO[input.toMode].label}.`);
  if (windowDays < 14) warnings.push('The baseline window is shorter than two weeks; the monthly projection is highly uncertain.');
  warnings.push('This is a simulation. It does not change your recorded trips and does not account for travel time, cost, safety or accessibility.');

  return {
    valueType: 'simulated',
    matchedTrips: matched.length - unavailable,
    matchedDistanceKm: distance,
    baselineKg,
    alternativeKg,
    deltaKg,
    deltaPctOfMatched: baselineKg > 0 ? (deltaKg / baselineKg) * 100 : null,
    projectedMonthlyDeltaKg: windowDays > 0 ? (deltaKg * 30) / windowDays : 0,
    baselineWindowDays: windowDays,
    unavailableTrips: unavailable,
    assumptions,
    warnings,
  };
}
