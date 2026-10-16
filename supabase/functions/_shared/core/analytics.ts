/**
 * Deterministic analytics over saved trip records. Trip records are authoritative; all summaries are
 * derived on demand so they are always consistent after edits and deletions.
 */
import { boundariesComparable } from './factors.ts';
import { MODE_INFO } from './modes.ts';
import {
  comparisonWindows,
  dateKeysInWindow,
  localDateKey,
  localMonthKey,
  monthKeysInWindow,
  periodRange,
  shiftPeriod,
  zonedTimeToUtc,
  type ComparisonWindows,
  type TimeWindow,
} from './time.ts';
import type { AccountingBoundary, PeriodKind, PeriodRange, TransportMode, Trip } from './types.ts';

/** Trips that count toward totals: not deleted and not dismissed by the user. */
export function isCountable(t: Pick<Trip, 'deletedAt' | 'confirmationStatus'>): boolean {
  return !t.deletedAt && t.confirmationStatus !== 'dismissed';
}

export function tripsInWindow<T extends Pick<Trip, 'startedAt' | 'deletedAt' | 'confirmationStatus'>>(trips: T[], w: TimeWindow): T[] {
  const s = Date.parse(w.start);
  const e = Date.parse(w.end);
  return trips.filter((t) => {
    const ts = Date.parse(t.startedAt);
    return isCountable(t) && ts >= s && ts < e;
  });
}

export interface ModeStats {
  mode: TransportMode;
  trips: number;
  distanceKm: number;
  emissionsKg: number;
  unavailableTrips: number;
}

export interface DayStats {
  date: string;
  trips: number;
  distanceKm: number;
  emissionsKg: number;
}

export interface PeriodSummary {
  window: TimeWindow;
  tripCount: number;
  distanceKm: number;
  /** Sum over trips with a calculated value. Trips with unavailable factors are excluded and counted separately. */
  emissionsKg: number;
  calculatedTrips: number;
  unavailableTrips: number;
  needsReviewTrips: number;
  autoTrips: number;
  manualTrips: number;
  byMode: ModeStats[];
  byDay: DayStats[];
  boundaries: AccountingBoundary[];
  boundariesComparable: boolean;
  factorSetVersions: string[];
  coverage: { daysInWindow: number; daysWithTrips: number };
}

export function summarize(trips: Trip[], window: TimeWindow, timeZone: string): PeriodSummary {
  const inWin = tripsInWindow(trips, window);
  const byMode = new Map<TransportMode, ModeStats>();
  const dayKeys = dateKeysInWindow(window, timeZone);
  const byDay = new Map<string, DayStats>(dayKeys.map((k) => [k, { date: k, trips: 0, distanceKm: 0, emissionsKg: 0 }]));
  const boundaries = new Set<AccountingBoundary>();
  const versions = new Set<string>();
  let distanceKm = 0;
  let emissionsKg = 0;
  let calculated = 0;
  let unavailable = 0;
  let needsReview = 0;
  let auto = 0;

  for (const t of inWin) {
    const m = byMode.get(t.mode) ?? { mode: t.mode, trips: 0, distanceKm: 0, emissionsKg: 0, unavailableTrips: 0 };
    m.trips += 1;
    m.distanceKm += t.distanceKm;
    distanceKm += t.distanceKm;
    const dk = localDateKey(t.startedAt, timeZone);
    const day = byDay.get(dk) ?? { date: dk, trips: 0, distanceKm: 0, emissionsKg: 0 };
    day.trips += 1;
    day.distanceKm += t.distanceKm;
    if (t.calcStatus === 'calculated' && t.emissionsKg != null) {
      m.emissionsKg += t.emissionsKg;
      emissionsKg += t.emissionsKg;
      day.emissionsKg += t.emissionsKg;
      calculated += 1;
      if (t.boundary) boundaries.add(t.boundary);
      versions.add(`${t.factorSetId}@${t.factorSetVersion}`);
    } else {
      m.unavailableTrips += 1;
      unavailable += 1;
    }
    if (t.confirmationStatus === 'needs_review') needsReview += 1;
    if (t.detectionSource === 'auto') auto += 1;
    byMode.set(t.mode, m);
    byDay.set(dk, day);
  }

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    window,
    tripCount: inWin.length,
    distanceKm,
    emissionsKg,
    calculatedTrips: calculated,
    unavailableTrips: unavailable,
    needsReviewTrips: needsReview,
    autoTrips: auto,
    manualTrips: inWin.length - auto,
    byMode: [...byMode.values()].sort((a, b) => b.emissionsKg - a.emissionsKg || b.distanceKm - a.distanceKm),
    byDay: days,
    boundaries: [...boundaries],
    boundariesComparable: boundariesComparable(boundaries),
    factorSetVersions: [...versions].sort(),
    coverage: { daysInWindow: dayKeys.length, daysWithTrips: days.filter((d) => d.trips > 0).length },
  };
}

/** Percentage change from `previous` to `current`. Returns null when there is no baseline (previous = 0). */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export interface ModeDelta {
  mode: TransportMode;
  currentKg: number;
  previousKg: number;
  deltaKg: number;
  currentTrips: number;
  previousTrips: number;
  deltaTrips: number;
  currentKm: number;
  previousKm: number;
  deltaKm: number;
  /** Fraction of the total absolute change attributable to this mode (signed; sums to 1 when the total change ≠ 0). */
  shareOfChange: number | null;
}

export type ChangeDirection = 'increase' | 'decrease' | 'no_change' | 'no_baseline' | 'no_data';

export interface PeriodComparison {
  windows: ComparisonWindows;
  current: PeriodSummary;
  previous: PeriodSummary;
  absoluteChangeKg: number;
  percentChange: number | null;
  direction: ChangeDirection;
  modeDeltas: ModeDelta[];
  /** Modes whose change moved in the same direction as the total, largest first (max 3). */
  mainContributors: ModeDelta[];
  dataQualityNotes: string[];
}

/** Changes smaller than this (kg) are reported as "no meaningful change". */
export const NO_CHANGE_THRESHOLD_KG = 0.05;

export function compareSummaries(current: PeriodSummary, previous: PeriodSummary, windows: ComparisonWindows): PeriodComparison {
  const modes = new Set<TransportMode>([...current.byMode.map((m) => m.mode), ...previous.byMode.map((m) => m.mode)]);
  const get = (s: PeriodSummary, mode: TransportMode) => s.byMode.find((m) => m.mode === mode);
  const absoluteChangeKg = current.emissionsKg - previous.emissionsKg;
  const modeDeltas: ModeDelta[] = [...modes].map((mode) => {
    const c = get(current, mode);
    const p = get(previous, mode);
    const deltaKg = (c?.emissionsKg ?? 0) - (p?.emissionsKg ?? 0);
    return {
      mode,
      currentKg: c?.emissionsKg ?? 0,
      previousKg: p?.emissionsKg ?? 0,
      deltaKg,
      currentTrips: c?.trips ?? 0,
      previousTrips: p?.trips ?? 0,
      deltaTrips: (c?.trips ?? 0) - (p?.trips ?? 0),
      currentKm: c?.distanceKm ?? 0,
      previousKm: p?.distanceKm ?? 0,
      deltaKm: (c?.distanceKm ?? 0) - (p?.distanceKm ?? 0),
      shareOfChange: Math.abs(absoluteChangeKg) > 1e-9 ? deltaKg / absoluteChangeKg : null,
    };
  });
  modeDeltas.sort((a, b) => Math.abs(b.deltaKg) - Math.abs(a.deltaKg));

  let direction: ChangeDirection;
  if (current.tripCount === 0 && previous.tripCount === 0) direction = 'no_data';
  else if (previous.calculatedTrips === 0) direction = 'no_baseline';
  else if (Math.abs(absoluteChangeKg) < NO_CHANGE_THRESHOLD_KG) direction = 'no_change';
  else direction = absoluteChangeKg > 0 ? 'increase' : 'decrease';

  const mainContributors =
    direction === 'increase' || direction === 'decrease'
      ? modeDeltas.filter((m) => Math.sign(m.deltaKg) === Math.sign(absoluteChangeKg) && Math.abs(m.deltaKg) >= NO_CHANGE_THRESHOLD_KG).slice(0, 3)
      : [];

  const notes: string[] = [];
  if (windows.basis === 'elapsed') notes.push(`Comparing the same elapsed period: ${windows.description}.`);
  if (current.unavailableTrips || previous.unavailableTrips) {
    notes.push(
      `${current.unavailableTrips + previous.unavailableTrips} trip(s) have no emission factor (e.g. "Unknown" or "Other public transport") and are excluded from the totals.`,
    );
  }
  if (current.needsReviewTrips) notes.push(`${current.needsReviewTrips} automatically detected trip(s) still need mode confirmation.`);
  if (!boundariesComparable([...current.boundaries, ...previous.boundaries])) {
    notes.push('Totals combine factors with different accounting boundaries (life-cycle rail labels and operational road factors).');
  }
  const versions = new Set([...current.factorSetVersions, ...previous.factorSetVersions]);
  if (versions.size > 1) {
    notes.push(`Trips were calculated with different factor-set versions (${[...versions].join(', ')}). Recalculate in Methodology for a like-for-like comparison.`);
  }
  if (previous.tripCount > 0 && current.coverage.daysWithTrips > 0 && Math.abs(current.autoTrips / Math.max(1, current.tripCount) - previous.autoTrips / Math.max(1, previous.tripCount)) > 0.5) {
    notes.push('The share of automatically detected vs. manually entered trips changed substantially; differences may partly reflect recording coverage rather than travel behaviour.');
  }

  return {
    windows,
    current,
    previous,
    absoluteChangeKg,
    percentChange: percentChange(current.emissionsKg, previous.emissionsKg),
    direction,
    modeDeltas,
    mainContributors,
    dataQualityNotes: notes,
  };
}

export function comparePeriods(trips: Trip[], range: PeriodRange, now: Date | number | string): PeriodComparison {
  const windows = comparisonWindows(range, now);
  const tz = range.timeZone;
  return compareSummaries(summarize(trips, windows.current, tz), summarize(trips, windows.previous, tz), windows);
}

/**
 * Average daily emissions over up to `days` complete local days before `beforeDayStart`, counting only days
 * on or after the user's first recorded trip (so new users are not compared against empty history).
 */
export function recentDailyAverage(trips: Trip[], dayRange: PeriodRange, days = 14): { averageKg: number; daysUsed: number } | null {
  const countable = trips.filter(isCountable);
  if (!countable.length) return null;
  const firstMs = Math.min(...countable.map((t) => Date.parse(t.startedAt)));
  let start = shiftPeriod(dayRange, -days);
  const firstDay = periodRange('day', firstMs, dayRange.timeZone);
  if (Date.parse(firstDay.start) > Date.parse(start.start)) start = firstDay;
  if (Date.parse(start.start) >= Date.parse(dayRange.start)) return null;
  const window = { start: start.start, end: dayRange.start };
  const s = summarize(trips, window, dayRange.timeZone);
  const daysUsed = s.coverage.daysInWindow;
  if (daysUsed === 0) return null;
  return { averageKg: s.emissionsKg / daysUsed, daysUsed };
}

export interface SeriesPoint {
  key: string;
  label: string;
  emissionsKg: number;
  distanceKm: number;
  trips: number;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Chart series for a period: daily points for day/week/month, monthly points for a year. */
export function seriesForPeriod(trips: Trip[], range: PeriodRange): SeriesPoint[] {
  const tz = range.timeZone;
  if (range.kind === 'year') {
    const keys = monthKeysInWindow(range, tz);
    const map = new Map<string, SeriesPoint>(keys.map((k) => [k, { key: k, label: MONTH_ABBR[Number(k.slice(5, 7)) - 1], emissionsKg: 0, distanceKm: 0, trips: 0 }]));
    for (const t of tripsInWindow(trips, range)) {
      const p = map.get(localMonthKey(t.startedAt, tz));
      if (!p) continue;
      p.trips += 1;
      p.distanceKm += t.distanceKm;
      if (t.calcStatus === 'calculated' && t.emissionsKg != null) p.emissionsKg += t.emissionsKg;
    }
    return [...map.values()];
  }
  if (range.kind === 'day') {
    // Hourly-free view: a single point for the day.
    const s = summarize(trips, range, tz);
    return [{ key: range.key, label: range.key.slice(5), emissionsKg: s.emissionsKg, distanceKm: s.distanceKm, trips: s.tripCount }];
  }
  const s = summarize(trips, range, tz);
  return s.byDay.map((d, i) => ({
    key: d.date,
    label: range.kind === 'week' ? WEEKDAY_ABBR[i] ?? d.date.slice(8) : String(Number(d.date.slice(8))),
    emissionsKg: d.emissionsKg,
    distanceKm: d.distanceKm,
    trips: d.trips,
  }));
}

/** Weekly totals for the `count` ISO weeks ending with the week containing `anchor`. */
export function weeklyTrend(trips: Trip[], anchor: Date | number | string, timeZone: string, count = 4): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let r = periodRange('week', anchor, timeZone);
  for (let i = 0; i < count; i++) {
    const s = summarize(trips, r, timeZone);
    out.unshift({ key: r.key, label: r.key.slice(5), emissionsKg: s.emissionsKg, distanceKm: s.distanceKm, trips: s.tripCount });
    r = shiftPeriod(r, -1);
  }
  return out;
}

/** Emissions of short private-motorised trips (≤ maxKm) that might be replaceable by lower-carbon modes. */
export function shortMotorisedTrips(trips: Trip[], w: TimeWindow, maxKm = 3): { trips: number; emissionsKg: number; shareOfTotal: number | null } {
  const inWin = tripsInWindow(trips, w);
  const total = inWin.reduce((a, t) => a + (t.calcStatus === 'calculated' ? t.emissionsKg ?? 0 : 0), 0);
  const short = inWin.filter((t) => MODE_INFO[t.mode].isPrivateMotorised && t.distanceKm <= maxKm);
  const kg = short.reduce((a, t) => a + (t.calcStatus === 'calculated' ? t.emissionsKg ?? 0 : 0), 0);
  return { trips: short.length, emissionsKg: kg, shareOfTotal: total > 0 ? kg / total : null };
}

export function periodLabel(range: PeriodRange): string {
  switch (range.kind) {
    case 'day':
      return range.key;
    case 'week':
      return `Week ${range.key.slice(6)} (${range.key.slice(0, 4)})`;
    case 'month':
      return `${MONTH_ABBR[Number(range.key.slice(5, 7)) - 1]} ${range.key.slice(0, 4)}`;
    case 'year':
      return range.key;
  }
}

/** Builds a PeriodRange for a key like 2026-10, 2026-10-10, 2026-W41 or 2026. */
export function rangeFromKey(kind: PeriodKind, key: string, timeZone: string): PeriodRange | null {
  let anchor: Date | null = null;
  if (kind === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const [y, m, d] = key.split('-').map(Number);
    anchor = zonedTimeToUtc(y, m, d, 12, 0, 0, timeZone);
  } else if (kind === 'month' && /^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split('-').map(Number);
    if (m < 1 || m > 12) return null;
    anchor = zonedTimeToUtc(y, m, 15, 12, 0, 0, timeZone);
  } else if (kind === 'year' && /^\d{4}$/.test(key)) {
    anchor = zonedTimeToUtc(Number(key), 6, 15, 12, 0, 0, timeZone);
  } else if (kind === 'week' && /^\d{4}-W\d{2}$/.test(key)) {
    const y = Number(key.slice(0, 4));
    const w = Number(key.slice(6));
    // ISO week 1 contains Jan 4th.
    const jan4 = zonedTimeToUtc(y, 1, 4, 12, 0, 0, timeZone);
    anchor = new Date(jan4.getTime() + (w - 1) * 7 * 86400000);
  }
  if (!anchor || Number.isNaN(anchor.getTime())) return null;
  const r = periodRange(kind, anchor, timeZone);
  return r.key === key ? r : null;
}
