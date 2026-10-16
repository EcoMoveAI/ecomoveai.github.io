/**
 * Turns location samples into saved trips: detection → classification → duplicate check → calculation → save.
 * Shared by the background TaskManager task and foreground tracking. Runs entirely on the device.
 */
import { classifyTrip } from '@core/classification.ts';
import { findDuplicate } from '@core/dedupe.ts';
import { flushDetector, processSamples, type DetectedTrip, type LocationSample } from '@core/detection.ts';
import { getFactorSetOrDefault } from '@core/factors.ts';
import { buildAutoTrip } from '@core/trips.ts';
import type { Trip } from '@core/types.ts';
import type { Repository } from '@/db/repository';

export interface PipelineDeps {
  now: () => Date;
  newId: () => string;
}

/** Simple async mutex so overlapping task invocations cannot interleave detector-state updates. */
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function saveDetected(repo: Repository, detected: DetectedTrip[], deps: PipelineDeps): Promise<Trip[]> {
  if (!detected.length) return [];
  const [prefs, settings] = await Promise.all([repo.getPreferences(), repo.getSettings()]);
  const set = getFactorSetOrDefault(prefs.factorSetId);
  const saved: Trip[] = [];
  for (const d of detected) {
    // 1) same detection delivered twice → identical dedupe key
    if (await repo.findByDedupeKey(d.dedupeKey)) continue;
    // 2) overlapping trip already recorded (e.g. entered manually, or by another tracking session)
    const dayMs = 86_400_000;
    const nearby = await repo.listTrips({
      start: new Date(Date.parse(d.startedAt) - dayMs).toISOString(),
      end: new Date(Date.parse(d.endedAt) + dayMs).toISOString(),
    });
    if (findDuplicate(d, nearby)) continue;
    const classification = classifyTrip(d.features);
    const trip = buildAutoTrip(d, classification, {
      id: deps.newId(),
      now: deps.now(),
      set,
      keepPreciseCoords: settings.keepPreciseCoords,
      defaultOccupancy: (m) => (m === 'car' ? prefs.defaultCarOccupancy : m === 'motorcycle' ? prefs.defaultMotorcycleOccupancy : null),
    });
    await repo.saveTrip(trip, 'pending');
    saved.push(trip);
  }
  return saved;
}

export function ingestSamples(repo: Repository, samples: LocationSample[], deps: PipelineDeps): Promise<Trip[]> {
  return serialized(async () => {
    const state = await repo.getDetectorState();
    const { state: next, trips } = processSamples(state, samples);
    const saved = await saveDetected(repo, trips, deps);
    await repo.setDetectorState(next);
    return saved;
  });
}

/** Ends any trip in progress (used when the user stops tracking) and clears the stored samples. */
export function flushTracking(repo: Repository, deps: PipelineDeps): Promise<Trip[]> {
  return serialized(async () => {
    const { state, trips } = flushDetector(await repo.getDetectorState());
    const saved = await saveDetected(repo, trips, deps);
    await repo.setDetectorState(state);
    return saved;
  });
}
