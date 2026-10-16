/**
 * Time-zone aware reporting periods.
 *
 * Definitions (documented in docs/METHODOLOGY.md):
 *  - A trip belongs to the local calendar day/week/month/year in which it STARTED, in the user's IANA time zone.
 *  - Weeks are ISO weeks (Monday 00:00 to next Monday 00:00 local time).
 *  - Periods are half-open intervals [start, end).
 *  - When the current period is still in progress, comparisons use the same elapsed portion of the previous
 *    period ("month-to-date vs. same elapsed days last month"), never an incomplete vs. a complete period.
 */
import type { PeriodKind, PeriodRange } from './types.ts';

export interface TimeWindow {
  start: string;
  end: string;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(instant: Date | number | string, timeZone: string): LocalParts {
  const date = instant instanceof Date ? instant : new Date(instant);
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Offset of the zone from UTC at the given instant, in milliseconds (e.g. +8h for Asia/Taipei). */
export function tzOffsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

/** Converts a local wall-clock time in `timeZone` to a UTC Date. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const off1 = tzOffsetMs(guess, timeZone);
  let t = guess - off1;
  const off2 = tzOffsetMs(t, timeZone);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

interface Ymd {
  year: number;
  month: number;
  day: number;
}

export function addDays(ymd: Ymd, n: number): Ymd {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** ISO weekday, Monday = 0 … Sunday = 6. */
export function isoWeekday(ymd: Ymd): number {
  return (new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day)).getUTCDay() + 6) % 7;
}

export function isoWeek(ymd: Ymd): { year: number; week: number } {
  const thursday = addDays(ymd, 3 - isoWeekday(ymd));
  const jan1 = Date.UTC(thursday.year, 0, 1);
  const t = Date.UTC(thursday.year, thursday.month - 1, thursday.day);
  return { year: thursday.year, week: Math.floor((t - jan1) / 86400000 / 7) + 1 };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function ymdKey(ymd: Ymd): string {
  return `${ymd.year}-${pad(ymd.month)}-${pad(ymd.day)}`;
}

export function localDateKey(instant: Date | number | string, timeZone: string): string {
  return ymdKey(zonedParts(instant, timeZone));
}

export function localMonthKey(instant: Date | number | string, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}`;
}

function midnight(ymd: Ymd, timeZone: string): Date {
  return zonedTimeToUtc(ymd.year, ymd.month, ymd.day, 0, 0, 0, timeZone);
}

export function periodRange(kind: PeriodKind, anchor: Date | number | string, timeZone: string): PeriodRange {
  const p = zonedParts(anchor, timeZone);
  const today: Ymd = { year: p.year, month: p.month, day: p.day };
  let startYmd: Ymd;
  let endYmd: Ymd;
  let key: string;
  switch (kind) {
    case 'day':
      startYmd = today;
      endYmd = addDays(today, 1);
      key = ymdKey(today);
      break;
    case 'week': {
      startYmd = addDays(today, -isoWeekday(today));
      endYmd = addDays(startYmd, 7);
      const w = isoWeek(startYmd);
      key = `${w.year}-W${pad(w.week)}`;
      break;
    }
    case 'month':
      startYmd = { year: p.year, month: p.month, day: 1 };
      endYmd = p.month === 12 ? { year: p.year + 1, month: 1, day: 1 } : { year: p.year, month: p.month + 1, day: 1 };
      key = `${p.year}-${pad(p.month)}`;
      break;
    case 'year':
      startYmd = { year: p.year, month: 1, day: 1 };
      endYmd = { year: p.year + 1, month: 1, day: 1 };
      key = `${p.year}`;
      break;
  }
  return {
    kind,
    start: midnight(startYmd, timeZone).toISOString(),
    end: midnight(endYmd, timeZone).toISOString(),
    key,
    timeZone,
  };
}

export function shiftPeriod(range: PeriodRange, steps: number): PeriodRange {
  let r = range;
  for (let i = 0; i < Math.abs(steps); i++) {
    r = steps < 0
      ? periodRange(r.kind, new Date(Date.parse(r.start) - 1), r.timeZone)
      : periodRange(r.kind, new Date(Date.parse(r.end)), r.timeZone);
  }
  return r;
}

export function containsInstant(w: TimeWindow, instant: Date | number | string): boolean {
  const t = new Date(instant).getTime();
  return t >= Date.parse(w.start) && t < Date.parse(w.end);
}

export interface ComparisonWindows {
  current: TimeWindow & { key: string };
  previous: TimeWindow & { key: string };
  /** 'elapsed' when the current period is still in progress and both windows are truncated to the same elapsed time. */
  basis: 'full' | 'elapsed';
  /** Plain-language description, e.g. "Oct 1–10 vs. Sep 1–10 (same elapsed period)". */
  description: string;
}

/**
 * Returns the windows to compare for a period. If `now` lies inside the selected period, the current window
 * ends at `now` and the previous window covers the same elapsed local time of the previous period.
 */
export function comparisonWindows(range: PeriodRange, now: Date | number | string): ComparisonWindows {
  const tz = range.timeZone;
  const prev = shiftPeriod(range, -1);
  const nowMs = new Date(now).getTime();
  if (!containsInstant(range, nowMs)) {
    return {
      current: { start: range.start, end: range.end, key: range.key },
      previous: { start: prev.start, end: prev.end, key: prev.key },
      basis: 'full',
      description: `${range.key} vs. ${prev.key} (complete periods)`,
    };
  }
  const n = zonedParts(nowMs, tz);
  const nYmd: Ymd = { year: n.year, month: n.month, day: n.day };
  let prevEnd: Date;
  switch (range.kind) {
    case 'day': {
      const y = addDays(nYmd, -1);
      prevEnd = zonedTimeToUtc(y.year, y.month, y.day, n.hour, n.minute, n.second, tz);
      break;
    }
    case 'week': {
      const y = addDays(nYmd, -7);
      prevEnd = zonedTimeToUtc(y.year, y.month, y.day, n.hour, n.minute, n.second, tz);
      break;
    }
    case 'month': {
      const pm = n.month === 1 ? { year: n.year - 1, month: 12 } : { year: n.year, month: n.month - 1 };
      const dim = daysInMonth(pm.year, pm.month);
      prevEnd = n.day > dim
        ? new Date(prev.end)
        : zonedTimeToUtc(pm.year, pm.month, n.day, n.hour, n.minute, n.second, tz);
      break;
    }
    case 'year': {
      const dim = daysInMonth(n.year - 1, n.month);
      prevEnd = zonedTimeToUtc(n.year - 1, n.month, Math.min(n.day, dim), n.hour, n.minute, n.second, tz);
      break;
    }
  }
  return {
    current: { start: range.start, end: new Date(nowMs).toISOString(), key: range.key },
    previous: { start: prev.start, end: prevEnd.toISOString(), key: prev.key },
    basis: 'elapsed',
    description: `${range.key} to date vs. the same elapsed period of ${prev.key}`,
  };
}

/** Local date keys (YYYY-MM-DD) for every local day overlapping the window. */
export function dateKeysInWindow(w: TimeWindow, timeZone: string): string[] {
  const keys: string[] = [];
  const startParts = zonedParts(w.start, timeZone);
  let cur: Ymd = { year: startParts.year, month: startParts.month, day: startParts.day };
  const endMs = Date.parse(w.end);
  for (let i = 0; i < 400; i++) {
    const m = midnight(cur, timeZone).getTime();
    if (m >= endMs) break;
    keys.push(ymdKey(cur));
    cur = addDays(cur, 1);
  }
  return keys;
}

/** Local month keys (YYYY-MM) overlapping the window. */
export function monthKeysInWindow(w: TimeWindow, timeZone: string): string[] {
  const keys: string[] = [];
  let r = periodRange('month', w.start, timeZone);
  const endMs = Date.parse(w.end);
  for (let i = 0; i < 240 && Date.parse(r.start) < endMs; i++) {
    keys.push(r.key);
    r = shiftPeriod(r, 1);
  }
  return keys;
}

export function minutesBetween(startIso: string, endIso: string): number {
  return (Date.parse(endIso) - Date.parse(startIso)) / 60000;
}
