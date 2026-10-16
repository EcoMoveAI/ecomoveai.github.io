/**
 * When a browser reminder is due. Mirrors the native schedule: daily summary at 21:00, weekly insight on
 * Monday 09:00, monthly report on the 1st at 09:00 (device local time). Pure and unit-tested.
 */
export type ReminderKind = 'dailySummary' | 'weeklyInsight' | 'monthlyReport';

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Returns the occurrence key (local date of the most recent due time) if that occurrence has not been
 * shown yet, otherwise null. `lastShownKey` is the key returned the last time this reminder was shown.
 */
export function shouldDeliverReminder(kind: ReminderKind, now: Date, lastShownKey: string | null): string | null {
  const due = new Date(now);
  switch (kind) {
    case 'dailySummary':
      due.setHours(21, 0, 0, 0);
      if (due > now) due.setDate(due.getDate() - 1);
      break;
    case 'weeklyInsight': {
      due.setHours(9, 0, 0, 0);
      const back = (due.getDay() + 6) % 7; // days since Monday
      due.setDate(due.getDate() - back);
      if (due > now) due.setDate(due.getDate() - 7);
      break;
    }
    case 'monthlyReport':
      due.setDate(1);
      due.setHours(9, 0, 0, 0);
      if (due > now) due.setMonth(due.getMonth() - 1);
      break;
  }
  const key = dayKey(due);
  return key === lastShownKey ? null : key;
}
