/** Personal data export (JSON + CSV) via the system share sheet. Files are written to the app's cache directory. */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Goal } from '@core/goals.ts';
import type { Trip, UserPreferences } from '@core/types.ts';
import { buildExportJson, tripsToCsv } from './exportFormat';

export { tripsToCsv };

export async function shareExport(format: 'json' | 'csv', data: { trips: Trip[]; goals: Goal[]; preferences: UserPreferences }): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `ecomove-export-${stamp}.${format}`);
  if (file.exists) file.delete();
  file.create();
  file.write(format === 'json' ? buildExportJson(data) : tripsToCsv(data.trips));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  // The file stays in the OS-managed cache (the receiving app may read it after this resolves);
  // it is replaced on the next export of the same day.
  await Sharing.shareAsync(file.uri, { mimeType: format === 'json' ? 'application/json' : 'text/csv', dialogTitle: 'Export EcoMove data' });
}
