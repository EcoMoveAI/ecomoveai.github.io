/**
 * Web build of the tracking controller. Automatic trip detection is NOT available in the browser:
 * pages cannot receive locations while closed or in the background, and emulating it with an open tab
 * would be unreliable and battery-hungry. Manual entry is the primary way to record trips on the web.
 * The API mirrors tracker.ts so screens compile unchanged; every function reports "unsupported".
 */
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

export const isExpoGo = false;
export const trackingSupported = false;

export async function getTrackingStatus(): Promise<TrackingStatus> {
  return { permission: 'none', canAskAgain: false, servicesEnabled: false, backgroundSupported: false, backgroundActive: false, foregroundActive: false, isExpoGo: false };
}

export async function requestForegroundPermission(): Promise<boolean> {
  return false;
}

export async function requestBackgroundPermission(): Promise<boolean> {
  return false;
}

export async function startTracking(): Promise<{ mode: 'background' | 'foreground' | 'none'; reason?: string }> {
  return { mode: 'none', reason: 'Automatic trip detection is only available in the EcoMove mobile app. Add trips manually here.' };
}

export async function stopTracking(_opts: { pause: boolean }): Promise<void> {}

export async function resumeIfEnabled(): Promise<void> {}

export const PLATFORM_NOTES: string[] = [];
