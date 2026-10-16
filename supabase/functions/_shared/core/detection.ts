/**
 * On-device trip segmentation from location samples (pure, resumable state machine).
 *
 * The background location task feeds batches of samples into `processSamples`, persists the returned state,
 * and saves completed trips. Raw samples never leave the device.
 *
 *  idle ──(moved > startRadius from the resting point)──▶ moving
 *  moving ──(stayed within stationaryRadius for ≥ stopAfter)──▶ idle  (trip ends when the stop began)
 *  moving ──(no samples for > maxGap, e.g. OS suspended the app)──▶ idle (trip ends at last sample, flagged)
 */
import type { TripFeatures } from './classification.ts';
import { haversineMeters } from './geo.ts';

export interface LocationSample {
  /** Epoch milliseconds. */
  ts: number;
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedMps: number | null;
}

export interface DetectorConfig {
  maxAccuracyM: number;
  startRadiusM: number;
  stationaryRadiusM: number;
  stopAfterMs: number;
  maxGapMs: number;
  minTripDistanceKm: number;
  minTripDurationMs: number;
  maxPlausibleSpeedKmh: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  maxAccuracyM: 80,
  startRadiusM: 150,
  stationaryRadiusM: 120,
  stopAfterMs: 5 * 60_000,
  maxGapMs: 20 * 60_000,
  minTripDistanceKm: 0.3,
  minTripDurationMs: 2 * 60_000,
  maxPlausibleSpeedKmh: 350,
};

export interface DetectorState {
  status: 'idle' | 'moving';
  /** Resting position while idle. */
  anchor: LocationSample | null;
  /** Most recent sample observed at the resting position. */
  lastIdle: LocationSample | null;
  /** Recent idle samples, used to back-date the trip start to when the user actually left. */
  idleBuffer?: LocationSample[];
  tripSamples: LocationSample[];
  /** First sample of the current candidate stop while moving. */
  stopCandidate: LocationSample | null;
  lastAccepted: LocationSample | null;
}

export const INITIAL_DETECTOR_STATE: DetectorState = {
  status: 'idle',
  anchor: null,
  lastIdle: null,
  tripSamples: [],
  stopCandidate: null,
  lastAccepted: null,
};

export type EndReason = 'stationary' | 'gap' | 'tracking_stopped';

export interface DetectedTrip {
  startedAt: string;
  endedAt: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  distanceKm: number;
  durationS: number;
  features: TripFeatures;
  endReason: EndReason;
  /** Deterministic key derived from the start sample, used for duplicate prevention. */
  dedupeKey: string;
}

export function autoDedupeKey(startTs: number): string {
  return `auto:${Math.floor(startTs / 1000)}`;
}

/** Path length with GPS-jitter suppression: short hops within the accuracy envelope are ignored. */
export function pathDistanceMeters(samples: LocationSample[]): number {
  if (samples.length < 2) return 0;
  let total = 0;
  let ref = samples[0];
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    const d = haversineMeters(ref, s);
    const threshold = Math.max(15, ((ref.accuracyM ?? 20) + (s.accuracyM ?? 20)) / 2);
    if (d >= threshold) {
      total += d;
      ref = s;
    }
  }
  // Include the final hop if it was suppressed but the trip ended away from the last reference point.
  const last = samples[samples.length - 1];
  if (ref !== last) total += haversineMeters(ref, last);
  return total;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function computeFeatures(samples: LocationSample[]): TripFeatures {
  const distanceM = pathDistanceMeters(samples);
  const durationS = samples.length > 1 ? (samples[samples.length - 1].ts - samples[0].ts) / 1000 : 0;
  const speeds: number[] = [];
  let stopCount = 0;
  let stoppedFor = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].ts - samples[i - 1].ts) / 1000;
    if (dt <= 0) continue;
    const reported = samples[i].speedMps;
    const kmh = reported != null && reported >= 0 ? reported * 3.6 : (haversineMeters(samples[i - 1], samples[i]) / dt) * 3.6;
    speeds.push(kmh);
    if (kmh < 2) {
      stoppedFor += dt;
    } else {
      if (stoppedFor >= 30) stopCount += 1;
      stoppedFor = 0;
    }
  }
  const accs = samples.map((s) => s.accuracyM).filter((a): a is number => a != null);
  return {
    distanceKm: distanceM / 1000,
    durationS,
    avgSpeedKmh: durationS > 0 ? (distanceM / 1000) / (durationS / 3600) : 0,
    p85SpeedKmh: percentile(speeds, 85),
    maxSpeedKmh: speeds.length ? Math.max(...speeds) : 0,
    stopCount,
    sampleCount: samples.length,
    meanAccuracyM: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null,
  };
}

function finalize(samples: LocationSample[], reason: EndReason, cfg: DetectorConfig): DetectedTrip | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const features = computeFeatures(samples);
  if (features.distanceKm < cfg.minTripDistanceKm) return null;
  if (last.ts - first.ts < cfg.minTripDurationMs) return null;
  return {
    startedAt: new Date(first.ts).toISOString(),
    endedAt: new Date(last.ts).toISOString(),
    start: { lat: first.lat, lng: first.lng },
    end: { lat: last.lat, lng: last.lng },
    distanceKm: features.distanceKm,
    durationS: features.durationS,
    features,
    endReason: reason,
    dedupeKey: autoDedupeKey(first.ts),
  };
}

function toIdle(at: LocationSample, lastIdle: LocationSample = at): DetectorState {
  return { status: 'idle', anchor: at, lastIdle, idleBuffer: [lastIdle], tripSamples: [], stopCandidate: null, lastAccepted: lastIdle };
}

const IDLE_BUFFER_SIZE = 20;

/**
 * When movement is confirmed, walk back through buffered idle samples to the last one that was still at the
 * resting point; the samples after it already belong to the trip.
 */
function departureSamples(state: DetectorState, cfg: DetectorConfig): LocationSample[] {
  const buf = state.idleBuffer?.length ? state.idleBuffer : [state.lastIdle ?? (state.anchor as LocationSample)];
  const anchor = state.anchor as LocationSample;
  const restRadius = Math.max(30, Math.min(cfg.stationaryRadiusM, 2 * (anchor.accuracyM ?? 15)));
  let lastAtRest = 0;
  for (let i = 0; i < buf.length; i++) {
    if (haversineMeters(anchor, buf[i]) <= restRadius) lastAtRest = i;
  }
  return buf.slice(lastAtRest);
}

export function processSamples(
  prevState: DetectorState,
  batch: LocationSample[],
  cfg: DetectorConfig = DEFAULT_DETECTOR_CONFIG,
): { state: DetectorState; trips: DetectedTrip[] } {
  let state: DetectorState = { ...prevState, tripSamples: [...prevState.tripSamples] };
  const trips: DetectedTrip[] = [];
  const sorted = [...batch].sort((a, b) => a.ts - b.ts);

  for (const s of sorted) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || !Number.isFinite(s.ts)) continue;
    if (s.accuracyM != null && s.accuracyM > cfg.maxAccuracyM) continue;
    const prev = state.lastAccepted;
    if (prev) {
      if (s.ts <= prev.ts) continue; // duplicate or out-of-order delivery
      const dtH = (s.ts - prev.ts) / 3_600_000;
      const kmh = haversineMeters(prev, s) / 1000 / dtH;
      if (kmh > cfg.maxPlausibleSpeedKmh && s.ts - prev.ts < cfg.maxGapMs) continue; // GPS jump
    }

    if (state.status === 'moving' && prev && s.ts - prev.ts > cfg.maxGapMs) {
      const t = finalize(state.tripSamples, 'gap', cfg);
      if (t) trips.push(t);
      state = toIdle(s);
      continue;
    }

    if (state.status === 'idle') {
      if (!state.anchor) {
        state = toIdle(s);
        continue;
      }
      if (haversineMeters(state.anchor, s) > cfg.startRadiusM) {
        state = { status: 'moving', anchor: null, lastIdle: null, idleBuffer: [], tripSamples: [...departureSamples(state, cfg), s], stopCandidate: null, lastAccepted: s };
      } else {
        const idleBuffer = [...(state.idleBuffer ?? []), s].slice(-IDLE_BUFFER_SIZE);
        state = { ...state, lastIdle: s, idleBuffer, lastAccepted: s };
      }
      continue;
    }

    // moving
    state.tripSamples.push(s);
    state.lastAccepted = s;
    const movingBySpeed = s.speedMps != null && s.speedMps > 2;
    if (!state.stopCandidate || movingBySpeed || haversineMeters(state.stopCandidate, s) > cfg.stationaryRadiusM) {
      state.stopCandidate = movingBySpeed ? null : s;
      continue;
    }
    if (s.ts - state.stopCandidate.ts >= cfg.stopAfterMs) {
      const stopAt = state.stopCandidate;
      const idx = state.tripSamples.indexOf(stopAt);
      const t = finalize(state.tripSamples.slice(0, idx + 1), 'stationary', cfg);
      if (t) trips.push(t);
      state = toIdle(stopAt, s);
    }
  }
  return { state, trips };
}

/** Ends any in-progress trip, e.g. when the user stops tracking. */
export function flushDetector(state: DetectorState, cfg: DetectorConfig = DEFAULT_DETECTOR_CONFIG): { state: DetectorState; trips: DetectedTrip[] } {
  if (state.status !== 'moving') return { state: INITIAL_DETECTOR_STATE, trips: [] };
  const t = finalize(state.tripSamples, 'tracking_stopped', cfg);
  return { state: INITIAL_DETECTOR_STATE, trips: t ? [t] : [] };
}
