/**
 * Tracking controller. Two modes:
 *  - background: OS-managed location updates delivered to the TaskManager task (needs "Always"/background
 *    permission and a development or release build — not Expo Go);
 *  - foreground: `watchPositionAsync` while the app is open (works with "While using the app").
 *
 * Sampling is battery-conscious (balanced accuracy, ≥25 m distance filter, deferred batches in background).
 * Nothing here bypasses OS privacy controls; if permission is denied, tracking simply does not start.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { getRepository } from '@/db/shared';
import { newId } from '@/services/ids';
import { emitDataChanged } from '@/state/events';
import { flushTracking, ingestSamples } from './pipeline';
import { LOCATION_TASK, toSample } from './task';

export type PermissionLevel = 'none' | 'foreground' | 'background';

export interface TrackingStatus {
  permission: PermissionLevel;
  canAskAgain: boolean;
  servicesEnabled: boolean;
  backgroundSupported: boolean;
  backgroundActive: boolean;
  foregroundActive: boolean;
  isExpoGo: boolean;
}

let foregroundSub: Location.LocationSubscription | null = null;

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
/** False in the web build (tracker.web.ts), where automatic trip detection does not exist. */
export const trackingSupported = true;

export async function getTrackingStatus(): Promise<TrackingStatus> {
  const [fg, bg, services, taskAvailable] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync().catch(() => ({ granted: false })),
    Location.hasServicesEnabledAsync().catch(() => false),
    TaskManager.isAvailableAsync().catch(() => false),
  ]);
  const backgroundActive = taskAvailable ? await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false) : false;
  return {
    permission: fg.granted ? (bg.granted ? 'background' : 'foreground') : 'none',
    canAskAgain: fg.canAskAgain,
    servicesEnabled: services,
    backgroundSupported: taskAvailable && !isExpoGo,
    backgroundActive,
    foregroundActive: foregroundSub != null,
    isExpoGo,
  };
}

export async function requestForegroundPermission(): Promise<boolean> {
  const r = await Location.requestForegroundPermissionsAsync();
  return r.granted;
}

/** Must only be called after the in-app explanation screen; foreground permission must already be granted. */
export async function requestBackgroundPermission(): Promise<boolean> {
  const r = await Location.requestBackgroundPermissionsAsync();
  return r.granted;
}

const BACKGROUND_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.Balanced,
  distanceInterval: 25,
  timeInterval: 15_000, // Android only
  deferredUpdatesInterval: 60_000,
  deferredUpdatesDistance: 100,
  activityType: Location.ActivityType.Other,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    // Deliberately generic: notification text never contains locations.
    notificationTitle: 'EcoMove AI trip detection is on',
    notificationBody: 'Tap to open the app, pause or stop tracking.',
    notificationColor: '#1F7A4D',
    killServiceOnDestroy: false,
  },
};

export async function startTracking(): Promise<{ mode: 'background' | 'foreground' | 'none'; reason?: string }> {
  const repo = await getRepository();
  const status = await getTrackingStatus();
  if (status.permission === 'none') return { mode: 'none', reason: 'Location permission has not been granted.' };
  if (!status.servicesEnabled) return { mode: 'none', reason: 'Location services are turned off in system settings.' };
  await repo.updateSettings({ trackingEnabled: true });
  await repo.setKv('tracking_paused', false);

  if (status.permission === 'background' && status.backgroundSupported) {
    if (!status.backgroundActive) await Location.startLocationUpdatesAsync(LOCATION_TASK, BACKGROUND_OPTIONS);
    stopForegroundWatch();
    return { mode: 'background' };
  }
  await startForegroundWatch();
  return {
    mode: 'foreground',
    reason: status.backgroundSupported
      ? 'Background permission not granted: trips are only detected while the app is open.'
      : 'Background tracking needs a development or release build (not Expo Go). Trips are detected only while the app is open.',
  };
}

async function startForegroundWatch(): Promise<void> {
  if (foregroundSub) return;
  const repo = await getRepository();
  foregroundSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 15_000 },
    (loc) => {
      ingestSamples(repo, [toSample(loc)], { now: () => new Date(), newId })
        .then((saved) => saved.length && emitDataChanged())
        .catch(() => undefined);
    },
  );
}

function stopForegroundWatch(): void {
  foregroundSub?.remove();
  foregroundSub = null;
}

/**
 * Both pause and stop end location collection immediately and close the current trip.
 * "Pause" is remembered so the UI can offer a one-tap resume; "stop" clears it.
 */
export async function stopTracking(opts: { pause: boolean }): Promise<void> {
  const repo = await getRepository();
  await repo.updateSettings({ trackingEnabled: false });
  await repo.setKv('tracking_paused', opts.pause);
  stopForegroundWatch();
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  const saved = await flushTracking(repo, { now: () => new Date(), newId });
  if (saved.length) emitDataChanged();
}

/** Resumes foreground watching after an app restart if the user had tracking on without background permission. */
export async function resumeIfEnabled(): Promise<void> {
  const repo = await getRepository();
  const settings = await repo.getSettings();
  if (!settings.trackingEnabled) return;
  const status = await getTrackingStatus();
  if (status.backgroundActive) return;
  if (status.permission === 'none') {
    await repo.updateSettings({ trackingEnabled: false });
    return;
  }
  await startTracking();
}

export const PLATFORM_NOTES: string[] =
  Platform.OS === 'ios'
    ? [
        'iOS asks first for "While Using the App"; "Always" can be granted later and iOS may ask you to confirm it again after a few days.',
        'If you force-quit the app from the app switcher, iOS stops delivering background locations until you open the app again.',
        'Low Power Mode and poor GPS signal (e.g. underground MRT) reduce the number of location updates.',
        'A blue location indicator shows whenever EcoMove is using location in the background.',
      ]
    : [
        'Android shows a persistent notification while trip detection runs; that is how Android keeps location access transparent.',
        'On Android 11+, "Allow all the time" must be chosen on the system settings page that opens.',
        'Some manufacturers (e.g. aggressive battery savers) stop background apps. Exclude EcoMove from battery optimisation if trips are missed.',
        'Swiping the app away may stop tracking on some devices; reopen the app to resume.',
      ];
