/** Web build of the personal data export: the file is generated in memory and downloaded by the browser. */
import type { Goal } from '@core/goals.ts';
import type { Trip, UserPreferences } from '@core/types.ts';
import { buildExportJson, tripsToCsv } from './exportFormat';

export { tripsToCsv };

export async function shareExport(format: 'json' | 'csv', data: { trips: Trip[]; goals: Goal[]; preferences: UserPreferences }): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const body = format === 'json' ? buildExportJson(data) : tripsToCsv(data.trips);
  const blob = new Blob([body], { type: format === 'json' ? 'application/json' : 'text/csv' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `ecomove-export-${stamp}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a moment to start the download before releasing the in-memory file.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
