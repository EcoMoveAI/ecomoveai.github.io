/**
 * Background location task. Imported from the app entry point (index.ts) so that it is defined in the
 * global scope before the OS can deliver locations to a headless (background) launch.
 */
import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { LocationSample } from '@core/detection.ts';
import { getRepository } from '@/db/shared';
import { newId } from '@/services/ids';
import { emitDataChanged } from '@/state/events';
import { ingestSamples } from './pipeline';

export const LOCATION_TASK = 'ecomove-location-updates';

export function toSample(l: Location.LocationObject): LocationSample {
  return {
    ts: l.timestamp,
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    accuracyM: l.coords.accuracy ?? null,
    speedMps: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
  };
}

try {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    try {
      const repo = await getRepository();
      const settings = await repo.getSettings();
      if (!settings.trackingEnabled) return; // user paused/stopped; ignore late deliveries
      const saved = await ingestSamples(repo, data.locations.map(toSample), { now: () => new Date(), newId });
      if (saved.length) emitDataChanged();
    } catch {
      // Never crash the headless task; samples for this batch are dropped.
    }
  });
} catch {
  // TaskManager is unavailable in some environments (e.g. Expo Go on Android); foreground tracking still works.
}
