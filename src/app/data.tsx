import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { getTrackingStatus, stopTracking } from '@/tracking/tracker';
import { shareExport } from '@/services/exportData';
import { fileImportSupported, pickTextFile } from '@/services/filePicker';
import { useApp } from '@/state/AppProvider';
import { Banner, Button, Card, Screen, T } from '@/ui/components';
import { confirmAction } from '@/ui/dialogs';

const where = Platform.OS === 'web' ? 'this browser' : 'this device';

export default function DataScreen() {
  const router = useRouter();
  const { trips, goals, prefs, cloudActive, deleteAllData, deleteAccount, importData } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'primary' | 'danger'; text: string; body?: string } | null>(null);

  async function run(label: string, fn: () => Promise<void>, success?: string) {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
      if (success) setMessage({ tone: 'primary', text: success });
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(null);
    }
  }

  async function stopTrackingIfRunning() {
    const s = await getTrackingStatus();
    if (s.backgroundActive || s.foregroundActive) await stopTracking({ pause: false });
  }

  const exportData = { trips: trips.map(({ syncStatus: _s, ...t }) => t), goals, preferences: prefs };

  return (
    <Screen>
      <Card>
        <T variant="title">Export your data</T>
        <T variant="small" muted>{`${trips.length} trip(s) and ${goals.length} goal(s). Includes every calculation snapshot (factor, version, boundary).`}</T>
        <Button title="Export as JSON" icon="code-download" variant="secondary" loading={busy === 'json'} onPress={() => run('json', () => shareExport('json', exportData))} />
        <Button title="Export trips as CSV" icon="grid" variant="secondary" loading={busy === 'csv'} onPress={() => run('csv', () => shareExport('csv', exportData))} />
      </Card>

      {fileImportSupported ? (
        <Card>
          <T variant="title">Import from the EcoMove app</T>
          <T variant="small" muted>
            Moving from the mobile app's on-device mode? Export as JSON on your phone, then import the file here. Trips keep their original emission factor and methodology version. Records that already exist and are newer here are not overwritten.
            {cloudActive ? ' Imported trips are then uploaded to your account.' : ''}
          </T>
          <Button
            title="Import a JSON export"
            icon="cloud-upload"
            variant="secondary"
            loading={busy === 'import'}
            onPress={() =>
              run('import', async () => {
                const text = await pickTextFile();
                if (text == null) return;
                const s = await importData(text);
                setMessage({
                  tone: 'primary',
                  text: `Imported ${s.tripsAdded} new trip(s), updated ${s.tripsUpdated}, ${s.goalsImported} goal(s).`,
                  body: [
                    s.unchanged ? `${s.unchanged} record(s) were already up to date.` : '',
                    s.skipped ? `${s.skipped} invalid record(s) skipped: ${s.problems.join('; ')}` : '',
                  ].filter(Boolean).join(' ') || undefined,
                });
              })
            }
          />
        </Card>
      ) : null}

      <Card tone="danger">
        <T variant="title">Delete all trips and goals</T>
        <T variant="small">Removes all trips and goals from {where}{cloudActive ? ' and your account' : ''}. Your account and preferences remain. This cannot be undone.</T>
        <Button
          title="Delete all trips and goals"
          variant="danger"
          icon="trash"
          loading={busy === 'data'}
          onPress={async () => {
            const ok = await confirmAction({ title: 'Delete all trips and goals?', message: 'This permanently deletes your mobility history. It cannot be undone.', confirmLabel: 'Delete', destructive: true });
            if (ok) void run('data', async () => { await stopTrackingIfRunning(); await deleteAllData(); }, 'All trips and goals were deleted.');
          }}
        />
      </Card>

      <Card tone="danger">
        <T variant="title">{cloudActive ? 'Delete my account' : 'Reset the app'}</T>
        <T variant="small">
          {cloudActive
            ? `Permanently deletes your EcoMove account and all associated data on the server (trips, goals, preferences, assistant metadata) and in ${where}.`
            : `Deletes all trips, goals, preferences and settings from ${where} and returns to the welcome screen.`}
        </T>
        <Button
          title={cloudActive ? 'Delete account permanently' : `Delete everything in ${where}`}
          variant="danger"
          icon="warning"
          loading={busy === 'account'}
          onPress={async () => {
            const ok = await confirmAction({ title: 'Are you sure?', message: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true });
            if (!ok) return;
            void run('account', async () => {
              await stopTrackingIfRunning();
              await deleteAccount();
              router.replace('/onboarding');
            });
          }}
        />
      </Card>

      {message ? <Banner tone={message.tone} icon={message.tone === 'danger' ? 'alert-circle' : 'checkmark-circle'} title={message.text} body={message.body} /> : null}
    </Screen>
  );
}
