import { comparePeriods, percentChange, recentDailyAverage, seriesForPeriod, shortMotorisedTrips, summarize, weeklyTrend } from '@core/analytics.ts';
import { generateInsights } from '@core/insights.ts';
import { periodRange } from '@core/time.ts';
import { makeTrip } from '../helpers';

const TZ = 'Asia/Taipei';

describe('percentChange', () => {
  it('computes signed percentages and returns null without a baseline', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(82, 100)).toBeCloseTo(-18);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(Number.NaN, 1)).toBeNull();
  });
});

describe('summarize', () => {
  const trips = [
    makeTrip('2026-10-01T01:00:00Z', 'car', 10), // 1.6725
    makeTrip('2026-10-01T10:00:00Z', 'metro', 8), // 0.6
    makeTrip('2026-10-02T01:00:00Z', 'walking', 1.5),
    makeTrip('2026-10-03T01:00:00Z', 'unknown', 4), // unavailable
    makeTrip('2026-10-04T01:00:00Z', 'taxi', 5, { confirmationStatus: 'dismissed' }),
    makeTrip('2026-10-05T01:00:00Z', 'bus', 5, { deletedAt: '2026-10-06T00:00:00Z' }),
    makeTrip('2026-09-30T15:59:00Z', 'car', 100), // 23:59 Sep 30 Taipei → previous month
  ];

  it('totals only countable trips in the local period and excludes unavailable factors from kg', () => {
    const s = summarize(trips, periodRange('month', '2026-10-10T00:00:00Z', TZ), TZ);
    expect(s.tripCount).toBe(4);
    expect(s.distanceKm).toBeCloseTo(23.5);
    expect(s.emissionsKg).toBeCloseTo(10 * 0.16725 + 8 * 0.075, 10);
    expect(s.unavailableTrips).toBe(1);
    expect(s.calculatedTrips).toBe(3);
    expect(s.byMode[0].mode).toBe('car');
    expect(s.byMode.find((m) => m.mode === 'unknown')?.unavailableTrips).toBe(1);
    expect(s.coverage).toEqual({ daysInWindow: 31, daysWithTrips: 3 });
    expect(s.boundariesComparable).toBe(false); // car (operational) + metro (life-cycle)
  });

  it('assigns a trip at 01:30 local time to the local day', () => {
    const t = makeTrip('2026-10-09T17:30:00Z', 'bus', 3);
    const day = summarize([t], periodRange('day', '2026-10-10T05:00:00Z', TZ), TZ);
    expect(day.tripCount).toBe(1);
    expect(day.byDay[0].date).toBe('2026-10-10');
  });

  it('returns an empty summary without fabricating data', () => {
    const s = summarize([], periodRange('week', '2026-10-10T00:00:00Z', TZ), TZ);
    expect(s).toMatchObject({ tripCount: 0, emissionsKg: 0, byMode: [] });
    expect(s.byDay).toHaveLength(7);
  });
});

describe('comparePeriods', () => {
  const now = '2026-10-10T04:00:00Z';
  const range = periodRange('month', now, TZ);

  it('compares with the same elapsed period and identifies the main contributors', () => {
    const trips = [
      // September 1–10 (comparable window)
      makeTrip('2026-09-02T01:00:00Z', 'car', 10),
      makeTrip('2026-09-05T01:00:00Z', 'metro', 10),
      // September after the 10th — must NOT be counted for an elapsed comparison
      makeTrip('2026-09-20T01:00:00Z', 'car', 200),
      // October 1–10
      makeTrip('2026-10-02T01:00:00Z', 'car', 10),
      makeTrip('2026-10-03T01:00:00Z', 'taxi', 20),
      makeTrip('2026-10-04T01:00:00Z', 'metro', 10),
    ];
    const c = comparePeriods(trips, range, now);
    expect(c.windows.basis).toBe('elapsed');
    expect(c.previous.tripCount).toBe(2);
    expect(c.current.tripCount).toBe(3);
    expect(c.absoluteChangeKg).toBeCloseTo(20 * 0.14861, 10);
    expect(c.direction).toBe('increase');
    expect(c.mainContributors.map((m) => m.mode)).toEqual(['taxi']);
    expect(c.percentChange).toBeCloseTo((20 * 0.14861) / (10 * 0.16725 + 10 * 0.075) * 100, 6);
    expect(c.dataQualityNotes.join(' ')).toMatch(/same elapsed period/);
  });

  it('reports no_baseline instead of a percentage when the previous period is empty', () => {
    const c = comparePeriods([makeTrip('2026-10-02T01:00:00Z', 'car', 10)], range, now);
    expect(c.direction).toBe('no_baseline');
    expect(c.percentChange).toBeNull();
  });

  it('notes mixed factor-set versions', () => {
    const trips = [
      makeTrip('2026-09-02T01:00:00Z', 'car', 10, { factorSetVersion: 'old-version' }),
      makeTrip('2026-10-02T01:00:00Z', 'car', 10),
    ];
    expect(comparePeriods(trips, range, now).dataQualityNotes.join(' ')).toMatch(/different factor-set versions/);
  });
});

describe('series, averages and insights', () => {
  it('builds monthly series for a year and daily series for a week', () => {
    const trips = [makeTrip('2026-02-10T01:00:00Z', 'car', 10), makeTrip('2026-02-11T01:00:00Z', 'car', 10)];
    const year = seriesForPeriod(trips, periodRange('year', '2026-05-01T00:00:00Z', TZ));
    expect(year).toHaveLength(12);
    expect(year[1]).toMatchObject({ key: '2026-02', label: 'Feb', trips: 2 });
    const week = seriesForPeriod(trips, periodRange('week', '2026-02-11T00:00:00Z', TZ));
    expect(week.map((p) => p.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('averages over days since the first trip, not before it', () => {
    const trips = [makeTrip('2026-10-08T01:00:00Z', 'car', 10), makeTrip('2026-10-09T01:00:00Z', 'car', 10)];
    const avg = recentDailyAverage(trips, periodRange('day', '2026-10-10T04:00:00Z', TZ), 14);
    expect(avg?.daysUsed).toBe(2);
    expect(avg?.averageKg).toBeCloseTo(1.6725);
    expect(recentDailyAverage([], periodRange('day', '2026-10-10T04:00:00Z', TZ))).toBeNull();
  });

  it('computes 4-week trend and short motorised trips', () => {
    const trips = [makeTrip('2026-10-06T01:00:00Z', 'car', 2), makeTrip('2026-10-07T01:00:00Z', 'metro', 10)];
    expect(weeklyTrend(trips, '2026-10-10T00:00:00Z', TZ, 4).map((p) => p.key)).toEqual(['2026-W38', '2026-W39', '2026-W40', '2026-W41']);
    const s = shortMotorisedTrips(trips, periodRange('week', '2026-10-10T00:00:00Z', TZ));
    expect(s.trips).toBe(1);
    expect(s.shareOfTotal).toBeCloseTo((2 * 0.16725) / (2 * 0.16725 + 0.75));
  });

  it('phrases changes as associations, not causes', () => {
    const now = '2026-10-10T04:00:00Z';
    const trips = [
      makeTrip('2026-09-02T01:00:00Z', 'car', 30),
      makeTrip('2026-10-02T01:00:00Z', 'car', 10),
      makeTrip('2026-10-03T01:00:00Z', 'metro', 15),
      makeTrip('2026-10-04T01:00:00Z', 'metro', 15),
    ];
    const insights = generateInsights(trips, periodRange('month', now, TZ), now);
    const change = insights.find((i) => i.kind === 'period_change');
    expect(change?.tone).toBe('positive');
    expect(change?.body).toMatch(/association/);
    expect(change?.body).not.toMatch(/because|caused/i);
    expect(insights.find((i) => i.kind === 'data_quality')?.body).toMatch(/boundaries/);
  });

  it('returns a no-data insight instead of fabricated comparisons', () => {
    const i = generateInsights([], periodRange('month', '2026-10-10T00:00:00Z', TZ), '2026-10-10T00:00:00Z');
    expect(i).toHaveLength(1);
    expect(i[0].kind).toBe('no_data');
  });
});
