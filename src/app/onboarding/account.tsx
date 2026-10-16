import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { isCloudConfigured } from '@/config';
import { useApp } from '@/state/AppProvider';
import { trackingSupported } from '@/tracking/tracker';
import { Banner, Button, Card, Screen, T } from '@/ui/components';

const isWeb = Platform.OS === 'web';

export default function AccountChoice() {
  const router = useRouter();
  const { updateSettings } = useApp();

  return (
    <Screen edges={['top', 'bottom']}>
      <T variant="h2">How would you like to use EcoMove?</T>
      <Card>
        <T variant="title">{isWeb ? 'In this browser only' : 'On this device only'}</T>
        <T variant="small" muted>
          {isWeb
            ? 'No account. Trips, dashboards, insights, goals and what-if scenarios work offline and are stored only in this browser — they are not backed up and are lost if you clear site data. The AI assistant needs an account.'
            : 'No account. Trips, dashboards, insights, goals and what-if scenarios work fully offline. The AI assistant needs an account.'}
        </T>
        <Button
          title={isWeb ? 'Use in this browser' : 'Use on this device'}
          variant="secondary"
          onPress={async () => {
            await updateSettings({ accountMode: 'local', onboardingComplete: true });
            router.replace(trackingSupported ? '/tracking' : '/');
          }}
        />
      </Card>
      <Card>
        <T variant="title">With an account</T>
        <T variant="small" muted>
          Secure sign-in, backup and sync across devices, and the AI assistant. Your data is protected by per-user access rules on the server.
        </T>
        <Button
          title="Sign in or create account"
          disabled={!isCloudConfigured}
          onPress={async () => {
            await updateSettings({ accountMode: 'cloud' });
            router.push('/auth');
          }}
        />
      </Card>
      {!isCloudConfigured ? (
        <Banner
          tone="info"
          icon="information-circle"
          title="Accounts are not configured in this build"
          body="This build has no backend configured (EXPO_PUBLIC_SUPABASE_URL is empty), so only the no-account mode is available. See the README to connect a Supabase project."
        />
      ) : null}
    </Screen>
  );
}
