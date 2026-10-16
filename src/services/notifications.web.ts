/**
 * Web build of the optional notifications. Browsers cannot schedule a notification for a time when the
 * page is closed without a Web Push server (VAPID keys + a scheduled sender), which this free-tier setup
 * does not include. Instead, reminders that have become due are shown the next time EcoMove is opened
 * (and as in-app summaries on the Home/Insights screens). Text is generic and never contains places.
 */
import { BASE_PATH } from '@/config';
import { shouldDeliverReminder, type ReminderKind } from '@/services/reminders';
import type { AppSettings } from '@/db/repository';

function api(): typeof Notification | null {
  return typeof window !== 'undefined' && 'Notification' in window ? window.Notification : null;
}

export const notificationsSupported = api() !== null;
export const notificationsNote =
  'In the browser, reminders appear when you next open EcoMove after they are due (browsers cannot schedule them while the site is closed). Installed PWAs on iOS need iOS 16.4 or later.';

export async function ensureNotificationPermission(): Promise<boolean> {
  const N = api();
  if (!N) return false;
  if (N.permission === 'granted') return true;
  if (N.permission === 'denied') return false;
  return (await N.requestPermission()) === 'granted';
}

async function show(title: string, body: string): Promise<void> {
  const N = api();
  if (!N || N.permission !== 'granted') return;
  // Android Chrome only allows notifications through a service worker registration.
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  const icon = `${BASE_PATH}/icons/icon-192.png`;
  if (reg) await reg.showNotification(title, { body, icon, tag: title });
  else new N(title, { body, icon, tag: title });
}

/** Nothing can be scheduled in the browser; due reminders are delivered by deliverDueReminders. */
export async function applyNotificationSchedule(_prefs: AppSettings['notifications']): Promise<void> {}

export async function notifyGoalProgress(title: string): Promise<void> {
  await show(title, 'Open EcoMove AI to see your goal progress.');
}

const TEXT: Record<ReminderKind, [string, string]> = {
  dailySummary: ['Your daily mobility summary is ready', "Open EcoMove AI to review today's trips."],
  weeklyInsight: ['A weekly mobility insight is available', 'See how this week compares with last week.'],
  monthlyReport: ['Your monthly mobility report is available', "Review last month's footprint and trends."],
};

/** Shows reminders that became due since they were last shown. Returns the updated "last shown" map. */
export async function deliverDueReminders(prefs: AppSettings['notifications'], lastShown: Record<string, string>, now: Date): Promise<Record<string, string>> {
  const next = { ...lastShown };
  for (const kind of Object.keys(TEXT) as ReminderKind[]) {
    if (!prefs[kind]) continue;
    const key = shouldDeliverReminder(kind, now, lastShown[kind] ?? null);
    if (!key) continue;
    // The first check after enabling only records the current occurrence, so turning a reminder on
    // does not immediately show one for a period that ended before it was enabled.
    if (lastShown[kind] !== undefined) await show(...TEXT[kind]);
    next[kind] = key;
  }
  return next;
}
