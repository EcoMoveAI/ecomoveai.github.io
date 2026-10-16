/**
 * Agent tools. Each tool:
 *  - declares one JSON schema used for the LLM definition AND server-side validation,
 *  - accesses data only through `AgentDataPort`, which is bound to the authenticated user (enforced by
 *    Row Level Security on the server); no tool accepts a user id, table name or SQL,
 *  - returns structured, labelled values (`recorded`, `estimate`, `simulated`) and never raw GPS coordinates.
 */
import { comparePeriods, periodLabel, rangeFromKey, seriesForPeriod, summarize, type PeriodSummary } from '../analytics.ts';
import { calculateEmissions } from '../calc.ts';
import { BOUNDARY_LABELS, getFactorSetOrDefault, UNVERIFIED_CANDIDATES } from '../factors.ts';
import { generateInsights } from '../insights.ts';
import { MODE_INFO } from '../modes.ts';
import type { RouteProvider, RouteTravelMode } from '../routing.ts';
import { compareModesForDistance, simulateModeShift } from '../scenario.ts';
import { periodRange, shiftPeriod, zonedTimeToUtc, type TimeWindow } from '../time.ts';
import { TRANSPORT_MODES, type FactorSet, type PeriodKind, type PeriodRange, type TransportMode, type Trip, type UserPreferences } from '../types.ts';
import { validateAgainstSchema, type JsonSchema } from './schema.ts';

export interface AgentDataPort {
  /** Returns ONLY the authenticated user's non-deleted trips that start inside the window. */
  listTrips(window: TimeWindow): Promise<Trip[]>;
  getPreferences(): Promise<UserPreferences>;
  routeProvider: RouteProvider;
  now(): Date;
}

export interface ToolContext {
  data: AgentDataPort;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Extract<JsonSchema, { type: 'object' }>;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

export class ToolInputError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join(' '));
    this.errors = errors;
    this.name = 'ToolInputError';
  }
}

const MAX_RANGE_DAYS = 400;
const modeEnum = { type: 'string', enum: TRANSPORT_MODES } as const;
const periodKindSchema = { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Reporting period type (local calendar of the user).' } as const;
const periodKeySchema = {
  type: 'string',
  maxLength: 10,
  pattern: '^(\\d{4}|\\d{4}-\\d{2}|\\d{4}-\\d{2}-\\d{2}|\\d{4}-W\\d{2})$',
  description: 'Period key: YYYY-MM-DD (day), YYYY-Www (ISO week), YYYY-MM (month) or YYYY (year). Omit for the current period.',
} as const;
const dateSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

const r4 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10000) / 10000);
const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);

async function resolveRange(ctx: ToolContext, kind: PeriodKind, key: unknown): Promise<PeriodRange> {
  const prefs = await ctx.data.getPreferences();
  if (typeof key === 'string' && key) {
    const r = rangeFromKey(kind, key, prefs.timeZone);
    if (!r) throw new ToolInputError([`period_key "${key}" does not match period_kind "${kind}".`]);
    return r;
  }
  return periodRange(kind, ctx.data.now(), prefs.timeZone);
}

function localDateWindow(start: string, end: string, tz: string): TimeWindow {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const s = zonedTimeToUtc(sy, sm, sd, 0, 0, 0, tz);
  const e = zonedTimeToUtc(ey, em, ed + 1, 0, 0, 0, tz); // end date inclusive
  if (!(e > s)) throw new ToolInputError(['end_date must be on or after start_date.']);
  if ((e.getTime() - s.getTime()) / 86400000 > MAX_RANGE_DAYS) throw new ToolInputError([`Date range is limited to ${MAX_RANGE_DAYS} days.`]);
  return { start: s.toISOString(), end: e.toISOString() };
}

function tripForAgent(t: Trip, tz: string) {
  return {
    id: t.id,
    start_local: new Date(t.startedAt).toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16),
    duration_min: Math.round((Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 60000),
    distance_km: r2(t.distanceKm),
    mode: t.mode,
    variant: t.variant,
    emissions_kg: r4(t.emissionsKg),
    calc_status: t.calcStatus,
    value_type: 'recorded',
    confirmation: t.confirmationStatus,
    detection: t.detectionSource,
    // Place labels only — coordinates are never sent to the LLM.
    origin: t.origin?.label ?? null,
    destination: t.destination?.label ?? null,
  };
}

function summaryForAgent(s: PeriodSummary) {
  return {
    value_type: 'recorded',
    trips: s.tripCount,
    distance_km: r2(s.distanceKm),
    emissions_kg: r4(s.emissionsKg),
    trips_with_unavailable_factor: s.unavailableTrips,
    trips_needing_review: s.needsReviewTrips,
    auto_detected_trips: s.autoTrips,
    manual_trips: s.manualTrips,
    by_mode: s.byMode.map((m) => ({ mode: m.mode, trips: m.trips, distance_km: r2(m.distanceKm), emissions_kg: r4(m.emissionsKg), unavailable: m.unavailableTrips })),
    days_with_trips: s.coverage.daysWithTrips,
    days_in_window: s.coverage.daysInWindow,
    accounting_boundaries: s.boundaries.map((b) => BOUNDARY_LABELS[b]),
    boundaries_comparable: s.boundariesComparable,
    factor_set_versions: s.factorSetVersions,
  };
}

function factorForAgent(f: FactorSet['factors'][number]) {
  return {
    id: f.id,
    mode: f.mode,
    variant: f.variant,
    label: f.variantLabel,
    value: f.value,
    unit: f.unit,
    boundary: BOUNDARY_LABELS[f.boundary],
    region: f.region,
    regional_proxy: f.isRegionalProxy,
    quality: f.quality,
    source: f.sourceOrg,
    source_url: f.sourceUrl,
    source_reference: f.sourceReference ?? null,
    effective_from: f.effectiveFrom ?? null,
    notes: f.methodologyNotes,
  };
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'get_trip_history',
    description:
      "Retrieve the user's recorded trips for a period (newest first). Use period_kind/period_key for calendar periods or start_date/end_date (local dates, inclusive). Returns place labels but never coordinates.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        period_kind: periodKindSchema,
        period_key: periodKeySchema,
        start_date: { ...dateSchema, description: 'Local start date YYYY-MM-DD (inclusive). Use with end_date instead of a period.' },
        end_date: { ...dateSchema, description: 'Local end date YYYY-MM-DD (inclusive).' },
        mode: { ...modeEnum, description: 'Only return trips with this mode.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum trips to return (default 50).' },
      },
    },
    async run(input, ctx) {
      const prefs = await ctx.data.getPreferences();
      let window: TimeWindow;
      if (input.start_date || input.end_date) {
        if (!input.start_date || !input.end_date) throw new ToolInputError(['Provide both start_date and end_date.']);
        window = localDateWindow(String(input.start_date), String(input.end_date), prefs.timeZone);
      } else {
        window = await resolveRange(ctx, (input.period_kind as PeriodKind) ?? 'month', input.period_key);
      }
      let trips = await ctx.data.listTrips(window);
      if (input.mode) trips = trips.filter((t) => t.mode === input.mode);
      trips = trips.filter((t) => t.confirmationStatus !== 'dismissed').sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const limit = (input.limit as number) ?? 50;
      return {
        window: { start: window.start, end: window.end, time_zone: prefs.timeZone },
        total_matching: trips.length,
        returned: Math.min(limit, trips.length),
        trips: trips.slice(0, limit).map((t) => tripForAgent(t, prefs.timeZone)),
      };
    },
  },
  {
    name: 'get_emissions_summary',
    description:
      'Get recorded emission totals for one day, ISO week, month or year in the user\'s time zone: totals, per-mode breakdown, data coverage and accounting boundaries, plus a daily (or monthly, for years) series.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['period_kind'],
      properties: { period_kind: periodKindSchema, period_key: periodKeySchema },
    },
    async run(input, ctx) {
      const range = await resolveRange(ctx, input.period_kind as PeriodKind, input.period_key);
      const trips = await ctx.data.listTrips(range);
      const s = summarize(trips, range, range.timeZone);
      const now = ctx.data.now();
      return {
        period: { kind: range.kind, key: range.key, label: periodLabel(range), start: range.start, end: range.end, in_progress: Date.parse(range.end) > now.getTime() },
        summary: summaryForAgent(s),
        series: seriesForPeriod(trips, range).map((p) => ({ key: p.key, emissions_kg: r4(p.emissionsKg), trips: p.trips })),
      };
    },
  },
  {
    name: 'get_emission_factors',
    description:
      "Return the emission factors in the user's selected methodology (value, unit, accounting boundary, source and caveats). Use this to cite sources or explain why two modes differ.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { mode: { ...modeEnum, description: 'Only return factors for this mode.' } },
    },
    async run(input, ctx) {
      const prefs = await ctx.data.getPreferences();
      const set = getFactorSetOrDefault(prefs.factorSetId);
      const factors = set.factors.filter((f) => !input.mode || f.mode === input.mode);
      const missing = TRANSPORT_MODES.filter((m) => !set.factors.some((f) => f.mode === m));
      return {
        factor_set: { id: set.id, version: set.version, name: set.name, mixed_boundaries: set.mixedBoundaries, caveats: set.caveats },
        default_variants: set.defaultVariants,
        factors: factors.map(factorForAgent),
        modes_without_factor: missing,
        unverified_values_not_used: UNVERIFIED_CANDIDATES.filter((c) => !input.mode || c.mode === input.mode),
      };
    },
  },
  {
    name: 'calculate_trip_emissions',
    description:
      'Calculate emissions for a hypothetical or described trip with the deterministic engine (distance × factor, ÷ occupancy for vehicle-km factors). Always use this instead of doing emission arithmetic yourself.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['distance_km', 'mode'],
      properties: {
        distance_km: { type: 'number', minimum: 0, maximum: 1500 },
        mode: modeEnum,
        variant: { type: 'string', maxLength: 40, description: 'Optional factor variant id from get_emission_factors.' },
        occupancy: { type: 'integer', minimum: 1, maximum: 9, description: 'People in the car/motorcycle including the user.' },
      },
    },
    async run(input, ctx) {
      const prefs = await ctx.data.getPreferences();
      const set = getFactorSetOrDefault(prefs.factorSetId);
      const mode = input.mode as TransportMode;
      const occupancy = (input.occupancy as number | undefined) ?? (mode === 'car' ? prefs.defaultCarOccupancy : mode === 'motorcycle' ? prefs.defaultMotorcycleOccupancy : null);
      const r = calculateEmissions({ distanceKm: input.distance_km as number, mode, variant: (input.variant as string) ?? null, occupancy }, set);
      return {
        value_type: 'estimate',
        status: r.status,
        emissions_kg: r4(r.emissionsKg),
        formula: r.formula,
        factor: r.factor ? factorForAgent(r.factor) : null,
        occupancy_applied: r.occupancyApplied,
        warnings: r.warnings,
        errors: r.errors,
        factor_set: `${set.id}@${set.version}`,
      };
    },
  },
  {
    name: 'compare_periods',
    description:
      'Compare a period with the previous comparable period. If the period is in progress, both sides are truncated to the same elapsed time. Returns absolute and % change, per-mode contributions and data-quality notes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['period_kind'],
      properties: { period_kind: periodKindSchema, period_key: periodKeySchema },
    },
    async run(input, ctx) {
      const range = await resolveRange(ctx, input.period_kind as PeriodKind, input.period_key);
      const prev = shiftPeriod(range, -1);
      const trips = await ctx.data.listTrips({ start: prev.start, end: range.end });
      const c = comparePeriods(trips, range, ctx.data.now());
      return {
        value_type: 'recorded',
        basis: c.windows.basis,
        description: c.windows.description,
        current: { key: c.windows.current.key, start: c.windows.current.start, end: c.windows.current.end, ...summaryForAgent(c.current) },
        previous: { key: c.windows.previous.key, start: c.windows.previous.start, end: c.windows.previous.end, ...summaryForAgent(c.previous) },
        absolute_change_kg: r4(c.absoluteChangeKg),
        percent_change: c.percentChange == null ? null : Math.round(c.percentChange * 10) / 10,
        direction: c.direction,
        mode_changes: c.modeDeltas.map((m) => ({ mode: m.mode, delta_kg: r4(m.deltaKg), delta_trips: m.deltaTrips, delta_km: r2(m.deltaKm), share_of_change: m.shareOfChange == null ? null : r2(m.shareOfChange) })),
        main_contributors: c.mainContributors.map((m) => m.mode),
        data_quality_notes: c.dataQualityNotes,
        interpretation_rule: 'These are associations in recorded data. Do not claim that one change caused another.',
      };
    },
  },
  {
    name: 'get_route_options',
    description:
      'Get real route options (distance, duration, transit legs) between two places from the configured routing provider, with emissions estimated per option by the calculation engine. Returns available=false if no provider is configured — never invent routes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['origin', 'destination'],
      properties: {
        origin: { type: 'string', minLength: 2, maxLength: 200, description: 'Address or place name.' },
        destination: { type: 'string', minLength: 2, maxLength: 200 },
        travel_modes: { type: 'array', maxItems: 5, items: { type: 'string', enum: ['drive', 'two_wheeler', 'walk', 'bicycle', 'transit'] } },
        departure_time: { type: 'string', maxLength: 40, description: 'ISO 8601 departure time for transit schedules.' },
      },
    },
    async run(input, ctx) {
      const prefs = await ctx.data.getPreferences();
      const set = getFactorSetOrDefault(prefs.factorSetId);
      const modes = ((input.travel_modes as RouteTravelMode[]) ?? ['drive', 'transit', 'walk', 'bicycle', 'two_wheeler']).slice(0, 5);
      if (input.departure_time && !Number.isFinite(Date.parse(String(input.departure_time)))) throw new ToolInputError(['departure_time must be an ISO date-time.']);
      const res = await ctx.data.routeProvider.getRoutes({ origin: String(input.origin), destination: String(input.destination), travelModes: modes, departureTime: input.departure_time as string | undefined });
      const options = res.options.map((o) => {
        let kg = 0;
        let unavailable = false;
        const segs = o.segments.map((s) => {
          const occupancy = s.mode === 'car' ? prefs.defaultCarOccupancy : s.mode === 'motorcycle' ? prefs.defaultMotorcycleOccupancy : null;
          const r = calculateEmissions({ distanceKm: s.distanceKm, mode: s.mode, occupancy }, set);
          if (r.emissionsKg == null) unavailable = true;
          else kg += r.emissionsKg;
          return { mode: s.mode, distance_km: r2(s.distanceKm), label: s.label ?? null, emissions_kg: r4(r.emissionsKg), factor_id: r.factor?.id ?? null };
        });
        return {
          travel_mode: o.travelMode,
          summary: o.summary,
          duration_min: Math.round(o.durationMin),
          distance_km: r2(o.distanceKm),
          segments: segs,
          emissions_kg: unavailable ? null : r4(kg),
          emissions_note: unavailable ? 'At least one segment has no emission factor; total unavailable.' : o.travelMode === 'drive' ? 'Private car; the same route by taxi uses the taxi factor (see compare_transport_modes).' : null,
          value_type: 'estimate',
        };
      });
      return { available: res.available, provider: res.provider, errors: res.errors, options, factor_set: `${set.id}@${set.version}`, user_max_extra_minutes: prefs.maxExtraMinutes };
    },
  },
  {
    name: 'compare_transport_modes',
    description:
      'Estimate emissions for the same distance across several transport modes using compatible factors from the user\'s methodology. Use when no routing provider is available or to compare alternatives for a recorded trip.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['distance_km'],
      properties: {
        distance_km: { type: 'number', minimum: 0.1, maximum: 1500 },
        modes: { type: 'array', minItems: 1, maxItems: 11, items: modeEnum },
      },
    },
    async run(input, ctx) {
      const prefs = await ctx.data.getPreferences();
      const set = getFactorSetOrDefault(prefs.factorSetId);
      const modes = (input.modes as TransportMode[]) ?? ['walking', 'cycling', 'bus', 'metro', 'train', 'motorcycle', 'car', 'taxi'];
      const c = compareModesForDistance(input.distance_km as number, modes, set, prefs);
      return {
        value_type: c.valueType,
        distance_km: c.distanceKm,
        factor_set: `${c.factorSetId}@${c.factorSetVersion}`,
        rows: c.rows.map((r) => ({ mode: r.mode, label: MODE_INFO[r.mode].label, variant: r.variantLabel, status: r.status, emissions_kg: r4(r.emissionsKg), boundary: r.boundary, formula: r.formula, warnings: r.warnings })),
        notes: c.notes,
      };
    },
  },
  {
    name: 'simulate_mobility_scenario',
    description:
      "Simulate replacing some of the user's recorded trips (by mode, optional place filter and max distance) with another mode, using the last N days as the baseline pattern. Returns simulated (not recorded) values and never modifies trip history.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['from_modes', 'to_mode'],
      properties: {
        from_modes: { type: 'array', minItems: 1, maxItems: 10, items: modeEnum },
        to_mode: modeEnum,
        to_variant: { type: 'string', maxLength: 40 },
        share_replaced: { type: 'number', minimum: 0, maximum: 1, description: 'Fraction of matching trips that switch (default 1).' },
        baseline_days: { type: 'integer', minimum: 7, maximum: 180, description: 'Days of history used as the baseline pattern (default 30).' },
        max_trip_km: { type: 'number', minimum: 0.1, maximum: 1500 },
        distance_multiplier: { type: 'number', minimum: 0.2, maximum: 5, description: 'Alternative route length relative to the recorded distance (default 1).' },
        place_filter: { type: 'string', maxLength: 60, description: 'Only trips whose origin/destination label contains this text, e.g. "campus".' },
      },
    },
    async run(input, ctx) {
      const prefs = await ctx.data.getPreferences();
      const set = getFactorSetOrDefault(prefs.factorSetId);
      const now = ctx.data.now();
      const days = (input.baseline_days as number) ?? 30;
      const window = { start: new Date(now.getTime() - days * 86400000).toISOString(), end: now.toISOString() };
      const trips = await ctx.data.listTrips(window);
      try {
        const r = simulateModeShift(
          trips,
          {
            fromModes: input.from_modes as TransportMode[],
            toMode: input.to_mode as TransportMode,
            toVariant: (input.to_variant as string) ?? null,
            shareReplaced: (input.share_replaced as number) ?? 1,
            baselineWindow: window,
            maxTripKm: (input.max_trip_km as number) ?? null,
            distanceMultiplier: (input.distance_multiplier as number) ?? null,
            placeFilter: (input.place_filter as string) ?? null,
          },
          set,
          prefs,
        );
        return {
          value_type: r.valueType,
          matched_trips: r.matchedTrips,
          matched_distance_km: r2(r.matchedDistanceKm),
          baseline_kg: r4(r.baselineKg),
          alternative_kg: r4(r.alternativeKg),
          delta_kg: r4(r.deltaKg),
          delta_pct_of_matched: r.deltaPctOfMatched == null ? null : Math.round(r.deltaPctOfMatched * 10) / 10,
          projected_monthly_delta_kg: r4(r.projectedMonthlyDeltaKg),
          baseline_window_days: Math.round(r.baselineWindowDays),
          assumptions: r.assumptions,
          warnings: r.warnings,
        };
      } catch (e) {
        throw new ToolInputError([e instanceof Error ? e.message : 'Invalid scenario.']);
      }
    },
  },
  {
    name: 'generate_sustainability_insight',
    description:
      'Run the deterministic insights engine for a period: largest-emitting mode, change vs. previous comparable period, peak day, short motorised trips, 4-week trend and data limitations. Each insight includes its evidence.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['period_kind'],
      properties: { period_kind: periodKindSchema, period_key: periodKeySchema },
    },
    async run(input, ctx) {
      const range = await resolveRange(ctx, input.period_kind as PeriodKind, input.period_key);
      const from = shiftPeriod(periodRange('week', range.end, range.timeZone), -5);
      const prev = shiftPeriod(range, -1);
      const start = Date.parse(from.start) < Date.parse(prev.start) ? from.start : prev.start;
      const trips = await ctx.data.listTrips({ start, end: range.end });
      return { period: range.key, insights: generateInsights(trips, range, ctx.data.now()) };
    },
  },
  {
    name: 'get_user_preferences',
    description:
      "Get the user's stated preferences and constraints: time zone, methodology, default car/motorcycle occupancy, maximum extra travel minutes, preferred/avoided modes and accessibility notes.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async run(_input, ctx) {
      const p = await ctx.data.getPreferences();
      const set = getFactorSetOrDefault(p.factorSetId);
      return {
        time_zone: p.timeZone,
        factor_set: { id: set.id, version: set.version, name: set.shortName },
        default_car_occupancy: p.defaultCarOccupancy,
        default_motorcycle_occupancy: p.defaultMotorcycleOccupancy,
        max_extra_minutes: p.maxExtraMinutes,
        preferred_modes: p.preferredModes,
        avoid_modes: p.avoidModes,
        accessibility_notes: p.accessibilityNotes,
      };
    },
  },
];

export function getTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

export interface ToolExecution {
  ok: boolean;
  output: unknown;
  error?: string;
}

/** Validates arguments and executes a tool with a timeout. Never throws. */
export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext, timeoutMs = 15_000): Promise<ToolExecution> {
  const tool = getTool(name);
  if (!tool) return { ok: false, output: { error: `Unknown tool "${name}".` }, error: 'unknown_tool' };
  const input = rawInput == null ? {} : rawInput;
  const errors = validateAgainstSchema(input, tool.inputSchema);
  if (errors.length) return { ok: false, output: { error: 'Invalid arguments', details: errors }, error: 'invalid_arguments' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([
      tool.run(input as Record<string, unknown>, ctx),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tool ${name} timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, output };
  } catch (e) {
    if (e instanceof ToolInputError) return { ok: false, output: { error: 'Invalid arguments', details: e.errors }, error: 'invalid_arguments' };
    return { ok: false, output: { error: 'The tool failed. Explain the limitation to the user and do not guess the missing data.' }, error: e instanceof Error ? e.message : 'tool_failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
