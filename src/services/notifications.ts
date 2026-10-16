/**
 * Optional local notifications. Disabled by default; scheduled only after the user turns a category on and
 * grants permission. Notification text is generic and never contains locations or trip details.
 *
 * expo-notifications throws on import inside Expo Go on Android (SDK 53+), so it is loaded lazily and
 * notifications are simply unavailable there. They work in development and release builds.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type { AppSettings } from '@/db/repository';

type NotificationsModule = typeof import('expo-notifications');

const CHANNEL = 'ecomove-reports';
let cached: NotificationsModule | null | undefined;

export const notificationsSupported = !(Constants.executionEnvironment === ExecutionEnvironment.StoreClient && Platform.OS === 'android');
/** Platform-specific explanation shown under the notification switches (web differs, see notifications.web.ts). */
export const notificationsNote: string | null = null;

/** Native notifications are scheduled by the OS, so there is nothing to deliver on app open. */
export async function deliverDueReminders(_prefs: AppSettings['notifications'], lastShown: Record<string, string>, _now: Date): Promise<Record<string, string>> {
  return lastShown;
}

function load(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (!notificationsSupported) return (cached = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load: the module throws on import in Expo Go (Android)
    const N = require('expo-notifications') as NotificationsModule;
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    cached = N;
  } catch {
    cached = null;
  }
  return cached;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const N = load();
  if (!N) return false;
  const current = await N.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const r = await N.requestPermissionsAsync();
  return r.granted;
}

async function ensureChannel(N: NotificationsModule) {
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync(CHANNEL, { name: 'Reports & goals', importance: N.AndroidImportance.DEFAULT });
  }
}

/** Re-creates the schedule from settings. Cancels everything when no category is enabled. */
export async function applyNotificationSchedule(prefs: AppSettings['notifications']): Promise<void> {
  const N = load();
  if (!N) return;
  await N.cancelAllScheduledNotificationsAsync();
  const any = prefs.dailySummary || prefs.weeklyInsight || prefs.monthlyReport;
  if (!any) return;
  if (!(await N.getPermissionsAsync()).granted) return;
  await ensureChannel(N);
  const channel = Platform.OS === 'android' ? { channelId: CHANNEL } : {};

  if (prefs.dailySummary) {
    await N.scheduleNotificationAsync({
      content: { title: 'Your daily mobility summary is ready', body: 'Open EcoMove AI to review today\'s trips.' },
      trigger: { type: N.SchedulableTriggerInputTypes.DAILY, hour: 21, minute: 0, ...channel },
    });
  }
  if (prefs.weeklyInsight) {
    await N.scheduleNotificationAsync({
      content: { title: 'A weekly mobility insight is available', body: 'See how this week compares with last week.' },
      trigger:
        Platform.OS === 'ios'
          ? { type: N.SchedulableTriggerInputTypes.CALENDAR, weekday: 2, hour: 9, minute: 0, repeats: true }
          : { type: N.SchedulableTriggerInputTypes.WEEKLY, weekday: 2, hour: 9, minute: 0, ...channel },
    });
  }
  if (prefs.monthlyReport) {
    await N.scheduleNotificationAsync({
      content: { title: 'Your monthly mobility report is available', body: 'Review last month\'s footprint and trends.' },
      trigger:
        Platform.OS === 'ios'
          ? { type: N.SchedulableTriggerInputTypes.CALENDAR, day: 1, hour: 9, minute: 0, repeats: true }
          : { type: N.SchedulableTriggerInputTypes.MONTHLY, day: 1, hour: 9, minute: 0, ...channel },
    });
  }
}

/** Immediate, generic goal notification (only if the user enabled goal notifications). */
export async function notifyGoalProgress(title: string): Promise<void> {
  const N = load();
  if (!N || !(await N.getPermissionsAsync()).granted) return;
  await ensureChannel(N);
  await N.scheduleNotificationAsync({ content: { title, body: 'Open EcoMove AI to see your goal progress.' }, trigger: null });
}
