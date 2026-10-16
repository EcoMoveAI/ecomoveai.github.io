/**
 * Location permission explanation, tracking setup and live status (screens 3, 4 and 6).
 * Background permission is requested only after this explanation and only when the user asks for it.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { useApp } from '@/state/AppProvider';
import {
  getTrackingStatus,
  PLATFORM_NOTES,
  requestBackgroundPermission,
  requestForegroundPermission,
  startTracking,
  stopTracking,
  trackingSupported,
  type TrackingStatus,
} from '@/tracking/tracker';
import { Banner, Button, Card, Divider, Row, Screen, T } from '@/ui/components';

export default function TrackingScreen() {
  return trackingSupported ? <NativeTrackingScreen /> : <WebTrackingNotice />;
}

/** Web build: explains why automatic detection is not offered instead of pretending it works. */
function WebTrackingNotice() {
  const router = useRouter();
  return (
    <Screen>
      <Card>
        <T variant="label">STATUS</T>
        <T variant="title">Not available on the web</T>
        <T variant="small">
          Automatic trip detection needs to receive your location while the app is closed or in the background. Browsers — including installed web apps — cannot do that reliably, so the EcoMove website does not track your location at all.
        </T>
        <T variant="small">• Add trips manually with "Add a trip": choose the mode, enter the distance and time, and review the emissions before saving.</T>
        <T variant="small">• If you used automatic detection in the EcoMove mobile app, export your data there as JSON and import it under Profile → Import, export & delete.</T>
        <T variant="small">• The website never asks for location permission.</T>
      </Card>
      <Button title="Add a trip" icon="add-circle" onPress={() => router.push('/trip/new')} />
      <Button title={'Done'} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </Screen>
  );
}

function NativeTrackingScreen() {
  const router = useRouter();
  const { settings, repo, refresh } = useApp();
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus(await getTrackingStatus());
    setPaused(repo ? await repo.getKv<boolean>('tracking_paused', false) : false);
  }, [repo]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      await load();
      await refresh();
      setBusy(false);
    }
  }

  const active = !!status && (status.backgroundActive || status.foregroundActive) && settings.trackingEnabled;

  return (
    <Screen>
      <Card tone={active ? 'primary' : 'default'}>
        <T variant="label">STATUS</T>
        <T variant="title">
          {active ? (status?.backgroundActive ? 'Detecting trips (background)' : 'Detecting trips (while app is open)') : paused ? 'Paused' : 'Off'}
        </T>
        <T variant="small" muted>
          {active
            ? 'Trips are detected on your phone. Uncertain transport modes are sent to you for confirmation.'
            : 'Automatic trip detection is not running. Manual trip entry always works.'}
        </T>
        {active ? (
          <Row style={{ flexWrap: 'wrap' }}>
            <Button title="Pause" icon="pause" variant="secondary" loading={busy} onPress={() => run(() => stopTracking({ pause: true }))} />
            <Button title="Stop" icon="stop" variant="danger" loading={busy} onPress={() => run(() => stopTracking({ pause: false }))} />
          </Row>
        ) : status && status.permission !== 'none' ? (
          <Button
            title={paused ? 'Resume tracking' : 'Start tracking'}
            icon="play"
            loading={busy}
            onPress={() =>
              run(async () => {
                const r = await startTracking();
                if (r.reason) setMessage(r.reason);
              })
            }
          />
        ) : null}
      </Card>

      {message ? <Banner tone="info" icon="information-circle" title="Note" body={message} /> : null}
      {status && !status.servicesEnabled ? (
        <Banner tone="warning" icon="location" title="Location services are off" body="Turn on location services in your phone's settings to detect trips." />
      ) : null}

      <Card>
        <T variant="title">Why EcoMove asks for location</T>
        <T variant="small">
          To detect a journey automatically, the app needs to notice when you start moving and when you arrive. It measures distance and speed on your phone to suggest a transport mode, then saves only the trip summary.
        </T>
        <T variant="small">• While using the app: trips are detected only while EcoMove is open.</T>
        <T variant="small">• Always / all the time (optional): trips are also detected when the app is closed. This is what makes automatic tracking useful, but it is entirely your choice.</T>
        <T variant="small">• EcoMove never sells location data, never sends GPS traces to the AI assistant, and you can delete trips at any time.</T>
      </Card>

      <Card>
        <T variant="label">STEP 1 · WHILE USING THE APP</T>
        <T variant="small" muted>{status?.permission === 'none' ? 'Not granted' : 'Granted'}</T>
        {status?.permission === 'none' ? (
          status.canAskAgain ? (
            <Button title="Allow while using the app" icon="location" onPress={() => run(async () => { await requestForegroundPermission(); })} />
          ) : (
            <>
              <T variant="small">Permission was denied. You can enable it in system settings, or keep using manual entry.</T>
              <Button title="Open system settings" variant="secondary" onPress={() => Linking.openSettings()} />
            </>
          )
        ) : null}
        <Divider />
        <T variant="label">STEP 2 · BACKGROUND (OPTIONAL)</T>
        <T variant="small" muted>
          {status?.permission === 'background'
            ? 'Granted'
            : !status?.backgroundSupported
              ? status?.isExpoGo
                ? 'Not available in Expo Go — install a development or release build.'
                : 'Not available on this device.'
              : 'Not granted'}
        </T>
        {status?.permission === 'foreground' && status.backgroundSupported ? (
          <>
            <T variant="small">Your phone will show a system prompt or open settings. Choose "Always" (iOS) or "Allow all the time" (Android).</T>
            <Button title="Allow background detection" icon="navigate" variant="secondary" onPress={() => run(async () => { await requestBackgroundPermission(); })} />
          </>
        ) : null}
      </Card>

      <Card>
        <T variant="title">Good to know on this phone</T>
        {PLATFORM_NOTES.map((n) => (
          <T key={n} variant="small">• {n}</T>
        ))}
        <T variant="small">• Automatic detection can miss or merge trips. Review "Needs review" trips in the Trips tab and add missing trips manually.</T>
      </Card>

      <View>
        <Button title={settings.onboardingComplete ? 'Done' : 'Continue'} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    </Screen>
  );
}
