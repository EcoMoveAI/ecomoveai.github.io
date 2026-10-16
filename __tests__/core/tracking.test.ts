import { AUTO_CONFIRM_CONFIDENCE, classifyTrip, type TripFeatures } from '@core/classification.ts';
import { findDuplicate, isLikelyDuplicate, overlapRatio } from '@core/dedupe.ts';
import { computeFeatures, flushDetector, INITIAL_DETECTOR_STATE, pathDistanceMeters, processSamples, type LocationSample } from '@core/detection.ts';
import { makeTrip } from '../helpers';

const T0 = Date.parse('2026-10-10T00:00:00Z');
const MIN = 60_000;

/** Straight line north from Taipei Main Station at a constant speed. 1° latitude ≈ 111.2 km. */
function line(startMs: number, minutes: number, kmh: number, startLat = 25.0478, everyS = 30, accuracy = 10): LocationSample[] {
  const out: LocationSample[] = [];
  for (let s = 0; s <= minutes * 60; s += everyS) {
    out.push({ ts: startMs + s * 1000, lat: startLat + ((kmh * s) / 3600) / 111.195, lng: 121.517, accuracyM: accuracy, speedMps: kmh / 3.6 });
  }
  return out;
}

function stay(startMs: number, minutes: number, lat: number, everyS = 60): LocationSample[] {
  const out: LocationSample[] = [];
  for (let s = 0; s <= minutes * 60; s += everyS) out.push({ ts: startMs + s * 1000, lat: lat + (s % 120 === 0 ? 0.00005 : -0.00005), lng: 121.517, accuracyM: 15, speedMps: 0 });
  return out;
}

describe('trip detection', () => {
  it('detects a walk that starts after resting and ends after 5 minutes stationary', () => {
    const rest = stay(T0, 10, 25.0478);
    const walk = line(T0 + 10 * MIN, 20, 5);
    const endLat = walk[walk.length - 1].lat;
    const after = stay(T0 + 30 * MIN + 30_000, 10, endLat);
    const { trips, state } = processSamples(INITIAL_DETECTOR_STATE, [...rest, ...walk, ...after]);
    expect(trips).toHaveLength(1);
    expect(trips[0].distanceKm).toBeGreaterThan(1.4);
    expect(trips[0].distanceKm).toBeLessThan(1.9);
    expect(trips[0].endReason).toBe('stationary');
    expect(Date.parse(trips[0].startedAt)).toBeLessThanOrEqual(T0 + 10 * MIN);
    expect(state.status).toBe('idle');
  });

  it('is resumable across batches (background task delivers samples in chunks)', () => {
    const all = [...stay(T0, 5, 25.0478), ...line(T0 + 5 * MIN, 15, 30)];
    const last = all[all.length - 1];
    const tail = stay(last.ts + 30_000, 8, last.lat);
    const samples = [...all, ...tail];
    let state = INITIAL_DETECTOR_STATE;
    const found = [];
    for (let i = 0; i < samples.length; i += 7) {
      const r = processSamples(state, samples.slice(i, i + 7));
      state = r.state;
      found.push(...r.trips);
    }
    const once = processSamples(INITIAL_DETECTOR_STATE, samples).trips;
    expect(found).toHaveLength(1);
    expect(found[0].distanceKm).toBeCloseTo(once[0].distanceKm, 6);
    expect(found[0].dedupeKey).toBe(once[0].dedupeKey);
  });

  it('ignores inaccurate fixes, duplicates and impossible jumps; ignores GPS jitter while stationary', () => {
    const base = stay(T0, 30, 25.0478, 30);
    const noisy: LocationSample[] = [
      ...base,
      { ts: T0 + 5 * MIN, lat: 25.06, lng: 121.517, accuracyM: 500, speedMps: null }, // inaccurate
      { ts: T0 + 6 * MIN + 1, lat: 26.5, lng: 121.517, accuracyM: 10, speedMps: null }, // teleport
      base[3], // duplicate timestamp
    ];
    const r = processSamples(INITIAL_DETECTOR_STATE, noisy);
    expect(r.trips).toHaveLength(0);
    expect(r.state.status).toBe('idle');
  });

  it('ends a trip at the last sample when the OS stops delivering locations (gap)', () => {
    const a = [...stay(T0, 3, 25.0478), ...line(T0 + 3 * MIN, 10, 25)];
    const resume = stay(T0 + 60 * MIN, 2, 25.2);
    const r = processSamples(INITIAL_DETECTOR_STATE, [...a, ...resume]);
    expect(r.trips).toHaveLength(1);
    expect(r.trips[0].endReason).toBe('gap');
  });

  it('discards very short movements and flushes an in-progress trip on stop', () => {
    const tiny = [...stay(T0, 3, 25.0478), ...line(T0 + 3 * MIN, 1, 12)];
    expect(processSamples(INITIAL_DETECTOR_STATE, tiny).trips).toHaveLength(0);
    const moving = processSamples(INITIAL_DETECTOR_STATE, [...stay(T0, 3, 25.0478), ...line(T0 + 3 * MIN, 10, 20)]);
    expect(moving.state.status).toBe('moving');
    const flushed = flushDetector(moving.state);
    expect(flushed.trips).toHaveLength(1);
    expect(flushed.trips[0].endReason).toBe('tracking_stopped');
  });

  it('suppresses jitter when measuring path length', () => {
    const jitter = stay(T0, 30, 25.0478, 30);
    expect(pathDistanceMeters(jitter)).toBeLessThan(50);
    expect(pathDistanceMeters(line(T0, 12, 30))).toBeCloseTo(6000, -2);
  });
});

describe('mode classification', () => {
  const f = (o: Partial<TripFeatures>): TripFeatures => ({ distanceKm: 3, durationS: 1800, avgSpeedKmh: 6, p85SpeedKmh: 6, maxSpeedKmh: 8, stopCount: 0, sampleCount: 60, meanAccuracyM: 10, ...o });

  it('auto-confirms walking at high confidence', () => {
    const c = classifyTrip(computeFeatures(line(T0, 20, 5)));
    expect(c.mode).toBe('walking');
    expect(c.confidence).toBeGreaterThanOrEqual(AUTO_CONFIRM_CONFIDENCE);
    expect(c.needsReview).toBe(false);
  });

  it('asks for review on motorised trips — GPS cannot distinguish car, taxi, bus or MRT', () => {
    const c = classifyTrip(f({ avgSpeedKmh: 35, p85SpeedKmh: 50, maxSpeedKmh: 70, distanceKm: 10 }));
    expect(c.needsReview).toBe(true);
    expect(c.confidence).toBeLessThanOrEqual(0.4);
    expect(c.candidates.map((x) => x.mode)).toEqual(expect.arrayContaining(['car', 'bus', 'metro', 'motorcycle', 'taxi']));
  });

  it('only reaches high cycling confidence with an OS activity signal', () => {
    expect(classifyTrip(f({ p85SpeedKmh: 18, maxSpeedKmh: 25, avgSpeedKmh: 15 })).needsReview).toBe(true);
    const withHint = classifyTrip(f({ p85SpeedKmh: 18, maxSpeedKmh: 25, avgSpeedKmh: 15, activityHint: 'cycling' }));
    expect(withHint.mode).toBe('cycling');
    expect(withHint.needsReview).toBe(false);
  });

  it('proposes HSR for sustained very high speed but still requires review', () => {
    const c = classifyTrip(f({ p85SpeedKmh: 270, maxSpeedKmh: 290, avgSpeedKmh: 200, distanceKm: 150 }));
    expect(c.mode).toBe('hsr');
    expect(c.needsReview).toBe(true);
  });

  it('lowers confidence when GPS accuracy is poor and handles too-few samples', () => {
    const walkPoor = classifyTrip(f({ meanAccuracyM: 70 }));
    expect(walkPoor.needsReview).toBe(true);
    expect(classifyTrip(f({ sampleCount: 2 })).mode).toBe('unknown');
  });
});

describe('duplicate detection', () => {
  const a = { startedAt: '2026-10-10T01:00:00Z', endedAt: '2026-10-10T01:30:00Z', distanceKm: 10 };

  it('flags overlapping trips with similar distance', () => {
    expect(overlapRatio(a, { startedAt: '2026-10-10T01:05:00Z', endedAt: '2026-10-10T01:32:00Z', distanceKm: 9 })).toBeGreaterThan(0.8);
    expect(isLikelyDuplicate(a, { startedAt: '2026-10-10T01:05:00Z', endedAt: '2026-10-10T01:32:00Z', distanceKm: 9 })).toBe(true);
  });

  it('does not flag sequential or very different trips', () => {
    expect(isLikelyDuplicate(a, { startedAt: '2026-10-10T01:30:00Z', endedAt: '2026-10-10T02:00:00Z', distanceKm: 10 })).toBe(false);
    expect(isLikelyDuplicate(a, { startedAt: '2026-10-10T01:00:00Z', endedAt: '2026-10-10T01:30:00Z', distanceKm: 2 })).toBe(false);
  });

  it('ignores dismissed and deleted trips when searching for duplicates', () => {
    const existing = [
      makeTrip('2026-10-10T01:00:00Z', 'car', 10, { confirmationStatus: 'dismissed' }),
      makeTrip('2026-10-10T01:00:00Z', 'car', 10, { deletedAt: '2026-10-10T03:00:00Z' }),
    ];
    expect(findDuplicate({ ...a, endedAt: '2026-10-10T01:20:00Z' }, existing)).toBeNull();
    const live = makeTrip('2026-10-10T01:00:00Z', 'car', 10);
    expect(findDuplicate({ ...a, endedAt: '2026-10-10T01:20:00Z' }, [live])?.id).toBe(live.id);
  });
});
