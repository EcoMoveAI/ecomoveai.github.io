import { comparisonWindows, dateKeysInWindow, isoWeek, localDateKey, periodRange, shiftPeriod, zonedTimeToUtc } from '@core/time.ts';
import { rangeFromKey } from '@core/analytics.ts';

const TPE = 'Asia/Taipei';
const NY = 'America/New_York';

describe('periods in the user time zone', () => {
  it('assigns trips to the local day (Taipei is UTC+8)', () => {
    // 2026-10-09T17:30Z is 01:30 on Oct 10 in Taipei.
    expect(localDateKey('2026-10-09T17:30:00Z', TPE)).toBe('2026-10-10');
    expect(localDateKey('2026-10-09T15:59:59Z', TPE)).toBe('2026-10-09');
  });

  it('builds day/month/year boundaries at local midnight', () => {
    const day = periodRange('day', '2026-10-10T03:00:00Z', TPE);
    expect(day).toMatchObject({ start: '2026-10-09T16:00:00.000Z', end: '2026-10-10T16:00:00.000Z', key: '2026-10-10' });
    const month = periodRange('month', '2026-10-10T03:00:00Z', TPE);
    expect(month).toMatchObject({ start: '2026-09-30T16:00:00.000Z', end: '2026-10-31T16:00:00.000Z', key: '2026-10' });
    const dec = periodRange('month', '2026-12-31T10:00:00Z', TPE);
    expect(dec.end).toBe('2026-12-31T16:00:00.000Z');
    const year = periodRange('year', '2026-06-01T00:00:00Z', TPE);
    expect(year).toMatchObject({ start: '2025-12-31T16:00:00.000Z', end: '2026-12-31T16:00:00.000Z', key: '2026' });
  });

  it('uses ISO weeks starting Monday', () => {
    // Saturday 2026-10-10 → week starts Monday 2026-10-05.
    const w = periodRange('week', '2026-10-10T03:00:00Z', TPE);
    expect(w.start).toBe('2026-10-04T16:00:00.000Z');
    expect(w.end).toBe('2026-10-11T16:00:00.000Z');
    expect(w.key).toBe('2026-W41');
    expect(isoWeek({ year: 2027, month: 1, day: 1 })).toEqual({ year: 2026, week: 53 });
    expect(isoWeek({ year: 2026, month: 1, day: 1 })).toEqual({ year: 2026, week: 1 });
  });

  it('handles daylight-saving transitions (23-hour and 25-hour days)', () => {
    const spring = periodRange('day', '2026-03-08T12:00:00Z', NY);
    expect((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000).toBe(23);
    const fall = periodRange('day', '2026-11-01T12:00:00Z', NY);
    expect((Date.parse(fall.end) - Date.parse(fall.start)) / 3600000).toBe(25);
    expect(zonedTimeToUtc(2026, 7, 1, 0, 0, 0, NY).toISOString()).toBe('2026-07-01T04:00:00.000Z');
  });

  it('shifts periods across year boundaries', () => {
    const jan = periodRange('month', '2026-01-15T00:00:00Z', TPE);
    expect(shiftPeriod(jan, -1).key).toBe('2025-12');
    expect(shiftPeriod(jan, 1).key).toBe('2026-02');
    expect(shiftPeriod(periodRange('week', '2026-01-01T00:00:00Z', TPE), -1).key).toBe('2025-W52');
  });

  it('lists local days in a window', () => {
    const w = periodRange('week', '2026-10-10T03:00:00Z', TPE);
    expect(dateKeysInWindow(w, TPE)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    const feb = periodRange('month', '2028-02-10T00:00:00Z', TPE);
    expect(dateKeysInWindow(feb, TPE)).toHaveLength(29);
  });

  it('parses period keys back into ranges', () => {
    expect(rangeFromKey('week', '2026-W41', TPE)?.start).toBe('2026-10-04T16:00:00.000Z');
    expect(rangeFromKey('month', '2026-02', TPE)?.key).toBe('2026-02');
    expect(rangeFromKey('day', '2026-02-30', TPE)).toBeNull();
    expect(rangeFromKey('month', '2026-13', TPE)).toBeNull();
    expect(rangeFromKey('year', '2026', TPE)?.key).toBe('2026');
  });
});

describe('comparison windows', () => {
  it('compares a month in progress with the same elapsed portion of the previous month', () => {
    const now = '2026-10-10T04:00:00Z'; // 12:00 on Oct 10 in Taipei
    const c = comparisonWindows(periodRange('month', now, TPE), now);
    expect(c.basis).toBe('elapsed');
    expect(c.current).toMatchObject({ start: '2026-09-30T16:00:00.000Z', end: '2026-10-10T04:00:00.000Z' });
    expect(c.previous).toMatchObject({ start: '2026-08-31T16:00:00.000Z', end: '2026-09-10T04:00:00.000Z', key: '2026-09' });
  });

  it('clamps to the end of a shorter previous month (Mar 31 vs. Feb)', () => {
    const now = '2026-03-31T04:00:00Z';
    const c = comparisonWindows(periodRange('month', now, TPE), now);
    expect(c.previous.end).toBe(periodRange('month', '2026-02-15T00:00:00Z', TPE).end);
  });

  it('compares complete periods when the selected period is in the past', () => {
    const c = comparisonWindows(periodRange('month', '2026-08-15T00:00:00Z', TPE), '2026-10-10T00:00:00Z');
    expect(c.basis).toBe('full');
    expect(c.previous.key).toBe('2026-07');
    expect(c.current.end).toBe(periodRange('month', '2026-08-15T00:00:00Z', TPE).end);
  });

  it('compares a week in progress with the same weekday/time last week', () => {
    const now = '2026-10-07T02:00:00Z'; // Wed 10:00 Taipei
    const c = comparisonWindows(periodRange('week', now, TPE), now);
    expect(c.previous.end).toBe('2026-09-30T02:00:00.000Z');
  });
});
