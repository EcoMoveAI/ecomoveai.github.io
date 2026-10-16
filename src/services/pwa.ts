/** Native builds are not PWAs; see pwa.web.ts. These no-ops keep shared screens platform-neutral. */
interface PwaState {
  updateReady: boolean;
  canInstall: boolean;
  installed: boolean;
  offlineReady: boolean;
}

const NATIVE: PwaState = { updateReady: false, canInstall: false, installed: true, offlineReady: false };

export const isStandalone = (): boolean => true;
export const isIos = (): boolean => false;
export function startPwa(): void {}
export function applyUpdate(): void {}
export async function promptInstall(): Promise<boolean> {
  return false;
}
export function usePwa(): PwaState {
  return NATIVE;
}
