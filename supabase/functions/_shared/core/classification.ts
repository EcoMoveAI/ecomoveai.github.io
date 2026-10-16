/**
 * Modular, conservative transport-mode classifier.
 *
 * GPS speed alone cannot reliably separate car, taxi, scooter, bus, MRT and train, so the classifier only
 * claims high confidence for walking (and cycling when the OS activity signal agrees). Motorised trips are
 * always returned with low confidence and `needsReview = true` so the user confirms the mode. Following a
 * rail line is never treated as sufficient evidence for MRT/train.
 *
 * Additional evidence sources (OS activity recognition, transit-stop matching) plug in via `activityHint`
 * and can be extended without changing callers.
 */
import type { TransportMode } from './types.ts';

export type ActivityHint = 'walking' | 'running' | 'cycling' | 'automotive' | 'stationary' | null;

export interface TripFeatures {
  distanceKm: number;
  durationS: number;
  avgSpeedKmh: number;
  /** 85th percentile of segment speeds — robust to brief GPS spikes. */
  p85SpeedKmh: number;
  maxSpeedKmh: number;
  /** Number of in-trip pauses (speed < 2 km/h for ≥ 30 s). */
  stopCount: number;
  sampleCount: number;
  meanAccuracyM: number | null;
  activityHint?: ActivityHint;
}

export interface Classification {
  mode: TransportMode;
  confidence: number;
  candidates: { mode: TransportMode; score: number }[];
  reasons: string[];
  needsReview: boolean;
}

/** Automatic trips at or above this confidence are saved as confirmed; others require user review. */
export const AUTO_CONFIRM_CONFIDENCE = 0.85;

const MOTORISED: TransportMode[] = ['car', 'motorcycle', 'taxi', 'bus', 'metro', 'train'];

function result(mode: TransportMode, confidence: number, candidates: { mode: TransportMode; score: number }[], reasons: string[]): Classification {
  const c = Math.max(0, Math.min(1, confidence));
  return { mode, confidence: Number(c.toFixed(2)), candidates, reasons, needsReview: c < AUTO_CONFIRM_CONFIDENCE };
}

export function classifyTrip(f: TripFeatures): Classification {
  const reasons: string[] = [];
  if (f.sampleCount < 3 || f.durationS <= 0) {
    return result('unknown', 0.1, MOTORISED.map((m) => ({ mode: m, score: 1 / MOTORISED.length })), ['Too few location samples to classify.']);
  }
  const poorAccuracy = f.meanAccuracyM != null && f.meanAccuracyM > 50;
  if (poorAccuracy) reasons.push(`Low GPS accuracy (mean ${Math.round(f.meanAccuracyM as number)} m) reduces confidence.`);
  const penalty = poorAccuracy ? 0.15 : 0;
  const hint = f.activityHint ?? null;

  // Walking: sustained low speeds.
  if (f.p85SpeedKmh < 7.5 && f.maxSpeedKmh < 14) {
    reasons.push(`85th-percentile speed ${f.p85SpeedKmh.toFixed(1)} km/h is consistent with walking.`);
    const conf = (hint === 'walking' || hint === 'running' ? 0.93 : 0.86) - penalty;
    return result('walking', conf, [{ mode: 'walking', score: conf }, { mode: 'cycling', score: 1 - conf }], reasons);
  }

  // Cycling-range speeds: ambiguous with scooters and buses in traffic.
  if (f.p85SpeedKmh < 28 && f.maxSpeedKmh < 40) {
    reasons.push(`Speeds (p85 ${f.p85SpeedKmh.toFixed(1)} km/h) fall in the cycling range but overlap with scooters and buses in traffic.`);
    if (hint === 'cycling') {
      reasons.push('The phone\'s activity recognition reported cycling.');
      return result('cycling', 0.88 - penalty, [{ mode: 'cycling', score: 0.88 }, { mode: 'motorcycle', score: 0.07 }, { mode: 'bus', score: 0.05 }], reasons);
    }
    if (hint === 'automotive') {
      reasons.push('Activity recognition reported a vehicle; please choose the vehicle type.');
      return result('bus', 0.35, [{ mode: 'bus', score: 0.35 }, { mode: 'motorcycle', score: 0.3 }, { mode: 'car', score: 0.2 }, { mode: 'taxi', score: 0.15 }], reasons);
    }
    return result('cycling', 0.5 - penalty, [{ mode: 'cycling', score: 0.5 }, { mode: 'motorcycle', score: 0.25 }, { mode: 'bus', score: 0.25 }], reasons);
  }

  // Very high sustained ground speeds in Taiwan are only reached by THSR.
  if (f.p85SpeedKmh >= 160) {
    reasons.push(`Sustained speeds above 160 km/h (p85 ${f.p85SpeedKmh.toFixed(0)} km/h) are typical of high-speed rail.`);
    return result('hsr', 0.75 - penalty, [{ mode: 'hsr', score: 0.75 }, { mode: 'train', score: 0.15 }, { mode: 'car', score: 0.1 }], reasons);
  }

  // Other motorised trips: GPS cannot tell these modes apart reliably.
  reasons.push('Motorised speeds detected. GPS alone cannot reliably tell car, taxi, scooter, bus, MRT or train apart, so please confirm the mode.');
  const stopsPerKm = f.distanceKm > 0 ? f.stopCount / f.distanceKm : 0;
  let scores: Record<string, number> = { car: 0.25, motorcycle: 0.2, taxi: 0.1, bus: 0.15, metro: 0.15, train: 0.15 };
  if (stopsPerKm > 1 && f.avgSpeedKmh < 30) {
    reasons.push('Frequent stops at low average speed are also consistent with a bus.');
    scores = { ...scores, bus: 0.3, car: 0.2 };
  }
  if (f.p85SpeedKmh > 90) {
    scores = { ...scores, car: 0.3, train: 0.3, motorcycle: 0.05, bus: 0.15, metro: 0.1, taxi: 0.1 };
  }
  const candidates = Object.entries(scores)
    .map(([mode, score]) => ({ mode: mode as TransportMode, score }))
    .sort((a, b) => b.score - a.score);
  return result(candidates[0].mode, Math.min(0.4, candidates[0].score), candidates, reasons);
}
