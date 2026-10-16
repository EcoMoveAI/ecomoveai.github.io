import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { getFactorSetOrDefault } from '@core/factors.ts';
import { isCloudConfigured } from '@/config';
import { isIos, promptInstall, usePwa } from '@/services/pwa';
import { useApp } from '@/state/AppProvider';
import { useOnline } from '@/state/useOnline';
import { trackingSupported } from '@/tracking/tracker';
import { Banner, Button, Card, ListItem, Screen, T } from '@/ui/components';
import { confirmAction } from '@/ui/dialogs';

const isWeb = Platform.OS === 'web';

export default function ProfileScreen() {
  const router = useRouter();
  const online = useOnline();
  const pwa = usePwa();
  const { session, settings, cloudActive, sync, prefs, signOut, syncNow } = useApp();
  const set = getFactorSetOrDefault(prefs.factorSetId);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  return (
    <Screen>
      <Card>
        <T variant="label">ACCOUNT</T>
        {cloudActive ? (
          <>
            <T variant="title">{session?.user.email}</T>
            <T variant="small" muted>
              {!online
                ? `Offline · ${sync.pending} change(s) saved in this ${isWeb ? 'browser' : 'device'}, waiting to sync`
                : sync.syncing ? 'Syncing…' : sync.pending ? `${sync.pending} change(s) waiting to sync` : 'All changes synced'}
              {sync.lastSyncAt ? ` · last sync ${new Date(sync.lastSyncAt).toLocaleString('en-GB', { timeZone: prefs.timeZone, dateStyle: 'short', timeStyle: 'short' })}` : ''}
            </T>
            {sync.lastError && online ? <T variant="small" muted>Last sync problem: {sync.lastError}. It will retry automatically.</T> : null}
            <Button title="Sync now" icon="sync" variant="secondary" loading={sync.syncing} disabled={!online} onPress={syncNow} />
          </>
        ) : (
          <>
            <T variant="title">{isWeb ? 'In this browser only' : 'On this device only'}</T>
            <T variant="small" muted>
              {isWeb
                ? 'Your data is stored only in this browser on this device and is not backed up. Clearing site data deletes it.'
                : 'Your data is stored only on this phone and is not backed up.'}
            </T>
            {isCloudConfigured ? <Button title="Sign in to back up & use the AI assistant" variant="secondary" onPress={() => router.push('/auth')} /> : null}
          </>
        )}
      </Card>

      {isWeb && !pwa.installed ? (
        <Card>
          <T variant="title">Install EcoMove</T>
          <T variant="small" muted>
            {pwa.canInstall
              ? 'Add EcoMove to your home screen or desktop to open it like an app and use it offline.'
              : isIos()
                ? 'In Safari, tap Share and then "Add to Home Screen" to install EcoMove.'
                : "Use your browser's menu (\"Install app\" or \"Add to Home screen\") to install EcoMove, if your browser supports it."}
            {' '}An installed web app still cannot track trips in the background — you add trips yourself.
          </T>
          {pwa.canInstall ? <Button title="Install app" icon="download" variant="secondary" onPress={() => void promptInstall()} /> : null}
        </Card>
      ) : null}

      <Card>
        <ListItem
          icon="navigate"
          title="Trip detection"
          subtitle={trackingSupported ? (settings.trackingEnabled ? 'On' : 'Off') : 'Mobile app only · add trips manually here'}
          onPress={() => router.push('/tracking')}
        />
        <ListItem icon="flag" title="Goals" subtitle="Personal, self-chosen targets" onPress={() => router.push('/goals')} />
        <ListItem icon="git-compare" title="What-if scenarios" subtitle="Simulate switching modes" onPress={() => router.push('/scenario')} />
        <ListItem icon="options" title="Preferences & notifications" subtitle={`Time zone ${prefs.timeZone}`} onPress={() => router.push('/preferences')} />
        <ListItem icon="book" title="Methodology & sources" subtitle={set.shortName} onPress={() => router.push('/methodology')} />
        <ListItem icon="shield-checkmark" title="Privacy & data controls" onPress={() => router.push('/privacy')} />
        <ListItem icon="download" title={isWeb ? 'Import, export & delete' : 'Export & delete'} subtitle="Download your data, delete trips or your account" onPress={() => router.push('/data')} />
      </Card>

      {cloudActive ? (
        <Button
          title="Sign out"
          variant="secondary"
          icon="log-out"
          onPress={async () => {
            const ok = await confirmAction({
              title: 'Sign out?',
              message: `Pending changes are uploaded first. Your trips are then removed from this ${isWeb ? 'browser' : 'device'} and remain in your account.`,
              confirmLabel: 'Sign out',
            });
            if (!ok) return;
            setSignOutError(null);
            try {
              await signOut();
            } catch (e) {
              setSignOutError(e instanceof Error ? e.message : 'Could not sign out.');
            }
          }}
        />
      ) : null}
      {signOutError ? <Banner tone="warning" icon="cloud-offline" title="Not signed out" body={signOutError} /> : null}
      <T variant="small" muted style={{ textAlign: 'center' }}>EcoMove AI 0.2.0{isWeb ? ' (web)' : ''} · Estimates are for personal awareness, not certified carbon accounting.</T>
    </Screen>
  );
}
