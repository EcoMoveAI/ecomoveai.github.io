/**
 * Rule-based sustainability insights computed from saved trips. Every insight carries its evidence
 * (period, numbers, coverage) so that the UI and the AI agent can explain it without inventing data.
 *
 * Language rules: describe associations, not causes ("emissions were lower while MRT trips increased"),
 * never shame the user, and always state the period and data limitations.
 */
import { formatKg } from './calc.ts';
import { comparePeriods, shortMotorisedTrips, summarize, weeklyTrend, type PeriodComparison } from './analytics.ts';
import { MODE_INFO } from './modes.ts';
import type { PeriodRange, Trip } from './types.ts';

export type InsightKind =
  | 'period_change'
  | 'top_mode'
  | 'peak_day'
  | 'short_motorised'
  | 'four_week_trend'
  | 'data_quality'
  | 'no_data';

export interface Insight {
  id: string;
  kind: InsightKind;
  title: string;
  body: string;
  /** Values the text is based on, so the claim can be audited. */
  evidence: Record<string, string | number | null>;
  /** 'info' for neutral facts, 'positive' for reductions, 'attention' for data-quality issues or increases. */
  tone: 'info' | 'positive' | 'attention';
}

function pct(n: number | null): string {
  return n == null ? 'n/a' : `${Math.abs(n).toFixed(0)}%`;
}

export function describeComparison(c: PeriodComparison): Insight | null {
  const basis = c.windows.basis === 'elapsed' ? 'compared with the same elapsed period' : 'compared with the previous period';
  const evidence = {
    currentPeriod: c.windows.current.key,
    previousPeriod: c.windows.previous.key,
    basis: c.windows.basis,
    currentKg: Number(c.current.emissionsKg.toFixed(4)),
    previousKg: Number(c.previous.emissionsKg.toFixed(4)),
    absoluteChangeKg: Number(c.absoluteChangeKg.toFixed(4)),
    percentChange: c.percentChange == null ? null : Number(c.percentChange.toFixed(1)),
    currentTrips: c.current.tripCount,
    previousTrips: c.previous.tripCount,
  };
  if (c.direction === 'no_data') return null;
  if (c.direction === 'no_baseline') {
    return {
      id: `change-${c.windows.current.key}`, kind: 'period_change', tone: 'info', evidence,
      title: 'Not enough history to compare yet',
      body: `There are no calculated trips in ${c.windows.previous.key}, so a change cannot be computed. Keep recording trips to unlock comparisons.`,
    };
  }
  if (c.direction === 'no_change') {
    return {
      id: `change-${c.windows.current.key}`, kind: 'period_change', tone: 'info', evidence,
      title: 'About the same as before',
      body: `Recorded emissions (${formatKg(c.current.emissionsKg)}) are essentially unchanged ${basis}.`,
    };
  }
  const up = c.direction === 'increase';
  const contributors = c.mainContributors
    .map((m) => {
      const tripPart = m.deltaTrips !== 0 ? `${m.deltaTrips > 0 ? '+' : ''}${m.deltaTrips} trips, ` : '';
      return `${MODE_INFO[m.mode].label} (${tripPart}${m.deltaKg > 0 ? '+' : ''}${formatKg(m.deltaKg)})`;
    })
    .join('; ');
  // Report modes that moved the opposite way as an association, never as a cause.
  const offsetting = c.modeDeltas.find((m) => Math.sign(m.deltaKg) !== Math.sign(c.absoluteChangeKg) && m.deltaTrips > 0);
  const assoc = offsetting
    ? ` Over the same period your recorded ${MODE_INFO[offsetting.mode].label} trips ${offsetting.deltaTrips > 0 ? 'increased' : 'decreased'} by ${Math.abs(offsetting.deltaTrips)}; this is an association in your records, not proof of cause.`
    : '';
  return {
    id: `change-${c.windows.current.key}`,
    kind: 'period_change',
    tone: up ? 'attention' : 'positive',
    evidence,
    title: up ? `Emissions ${pct(c.percentChange)} higher` : `Emissions ${pct(c.percentChange)} lower`,
    body:
      `Your recorded mobility emissions were ${formatKg(c.current.emissionsKg)} (${up ? '+' : '−'}${formatKg(Math.abs(c.absoluteChangeKg))}, ${pct(c.percentChange)}) ${basis} (${c.windows.previous.key}).` +
      (contributors ? ` The largest changes came from: ${contributors}.` : '') +
      assoc,
  };
}

export function generateInsights(trips: Trip[], range: PeriodRange, now: Date | number | string): Insight[] {
  const tz = range.timeZone;
  const summary = summarize(trips, range, tz);
  const out: Insight[] = [];

  if (summary.tripCount === 0) {
    return [{
      id: `nodata-${range.key}`, kind: 'no_data', tone: 'info', evidence: { period: range.key },
      title: 'No trips recorded for this period',
      body: 'Add a trip manually or enable tracking to see insights. Nothing is estimated for days without records.',
    }];
  }

  const cmp = comparePeriods(trips, range, now);
  const change = describeComparison(cmp);
  if (change) out.push(change);

  const top = summary.byMode.find((m) => m.emissionsKg > 0);
  if (top && summary.emissionsKg > 0) {
    const share = top.emissionsKg / summary.emissionsKg;
    out.push({
      id: `top-${range.key}`, kind: 'top_mode', tone: 'info',
      evidence: { period: range.key, mode: top.mode, modeKg: Number(top.emissionsKg.toFixed(4)), totalKg: Number(summary.emissionsKg.toFixed(4)), share: Number(share.toFixed(3)), trips: top.trips },
      title: `${MODE_INFO[top.mode].label} is your largest source`,
      body: `${MODE_INFO[top.mode].label} accounted for ${(share * 100).toFixed(0)}% of recorded emissions (${formatKg(top.emissionsKg)} over ${top.trips} trip${top.trips === 1 ? '' : 's'}) in ${range.key}.`,
    });
  }

  if (range.kind !== 'day') {
    const peak = [...summary.byDay].sort((a, b) => b.emissionsKg - a.emissionsKg)[0];
    if (peak && peak.emissionsKg > 0 && summary.coverage.daysWithTrips > 1) {
      out.push({
        id: `peak-${range.key}`, kind: 'peak_day', tone: 'info',
        evidence: { date: peak.date, kg: Number(peak.emissionsKg.toFixed(4)), trips: peak.trips },
        title: 'Highest-footprint day',
        body: `${peak.date} had the highest recorded footprint (${formatKg(peak.emissionsKg)} across ${peak.trips} trip${peak.trips === 1 ? '' : 's'}).`,
      });
    }
  }

  const short = shortMotorisedTrips(trips, range, 3);
  if (short.trips > 0 && short.shareOfTotal != null && short.emissionsKg > 0) {
    out.push({
      id: `short-${range.key}`, kind: 'short_motorised', tone: 'info',
      evidence: { trips: short.trips, kg: Number(short.emissionsKg.toFixed(4)), shareOfTotal: Number(short.shareOfTotal.toFixed(3)), maxKm: 3 },
      title: 'Short car, taxi and scooter trips',
      body: `${short.trips} trip${short.trips === 1 ? '' : 's'} of 3 km or less by private motorised modes produced ${formatKg(short.emissionsKg)} (${(short.shareOfTotal * 100).toFixed(0)}% of the total). Some may be practical to walk, cycle or take by public transport — only you can judge safety, accessibility and convenience.`,
    });
  }

  if (range.kind === 'month' || range.kind === 'week') {
    const trend = weeklyTrend(trips, now, tz, 4);
    if (trend.filter((p) => p.trips > 0).length >= 3) {
      out.push({
        id: `trend-${range.key}`, kind: 'four_week_trend', tone: 'info',
        evidence: Object.fromEntries(trend.map((p) => [p.key, Number(p.emissionsKg.toFixed(3))])),
        title: 'Last four weeks',
        body: `Weekly totals: ${trend.map((p) => `${p.label} ${formatKg(p.emissionsKg)}`).join(', ')}.`,
      });
    }
  }

  const quality: string[] = [];
  if (summary.needsReviewTrips) quality.push(`${summary.needsReviewTrips} trip(s) need mode confirmation`);
  if (summary.unavailableTrips) quality.push(`${summary.unavailableTrips} trip(s) have no emission factor and are excluded`);
  if (!summary.boundariesComparable) quality.push('totals mix life-cycle (rail/MRT) and operational (road) factor boundaries');
  if (quality.length) {
    out.push({
      id: `quality-${range.key}`, kind: 'data_quality', tone: 'attention',
      evidence: { needsReview: summary.needsReviewTrips, unavailable: summary.unavailableTrips, boundariesComparable: summary.boundariesComparable ? 1 : 0 },
      title: 'Data limitations',
      body: `For ${range.key}: ${quality.join('; ')}.`,
    });
  }
  return out;
}
