/**
 * Web build: there is no background location task. Browsers cannot deliver locations to a closed page,
 * so automatic trip detection is a native-app feature only (see docs/MIGRATION_REPORT.md).
 */
import type * as Location from 'expo-location';
import type { LocationSample } from '@core/detection.ts';

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
