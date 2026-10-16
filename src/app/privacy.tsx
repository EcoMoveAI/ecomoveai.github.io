import { useRouter } from 'expo-router';
import { Platform, Switch, View } from 'react-native';
import { PRIVACY_NOTICE_VERSION } from '@/config';
import { useApp } from '@/state/AppProvider';
import { Button, Card, Chip, Row, Screen, T } from '@/ui/components';
import { usePalette } from '@/ui/theme';

const isWeb = Platform.OS === 'web';

const RETENTION_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Keep', value: null },
  { label: '24 months', value: 24 },
  { label: '12 months', value: 12 },
  { label: '6 months', value: 6 },
];

export default function PrivacyScreen() {
  const router = useRouter();
  const c = usePalette();
  const { settings, updateSettings } = useApp();
  const consented = settings.onboardingComplete;

  return (
    <Screen>
      <T variant="small" muted>Privacy notice version {PRIVACY_NOTICE_VERSION}</T>

      {consented ? (
        <Card>
          <T variant="title">Data controls</T>
          {!isWeb ? (
            <Row style={{ justifyContent: 'space-between', minHeight: 44 }}>
              <View style={{ flex: 1 }}>
                <T>Store precise trip endpoints</T>
                <T variant="small" muted>Off: automatically detected start/end coordinates are rounded to about 110 m.</T>
              </View>
              <Switch value={settings.keepPreciseCoords} onValueChange={(v) => void updateSettings({ keepPreciseCoords: v })} trackColor={{ true: c.primary }} accessibilityLabel="Store precise trip endpoints" />
            </Row>
          ) : null}
          <T>Automatically delete trips older than</T>
          <Row style={{ flexWrap: 'wrap' }}>
            {RETENTION_OPTIONS.map((o) => (
              <Chip key={o.label} label={o.label} selected={settings.tripRetentionMonths === o.value} onPress={() => void updateSettings({ tripRetentionMonths: o.value })} />
            ))}
          </Row>
          <T variant="small" muted>Applied each time the app starts.{isWeb ? '' : ' Raw GPS points are always deleted as soon as a trip ends.'}</T>
          <Button title={isWeb ? 'Import, export or delete my data' : 'Export or delete my data'} variant="secondary" icon="download" onPress={() => router.push('/data')} />
        </Card>
      ) : null}

      <Card>
        <T variant="title">What we collect and why</T>
        <T variant="small">• Trip summaries (time, duration, distance, mode, emissions, factor used): to show your footprint and trends.</T>
        {isWeb ? (
          <T variant="small">• Location: the website never requests or uses your location. Trips are entered by you. (Trips imported from the mobile app may contain rounded start/end coordinates recorded there.)</T>
        ) : (
          <T variant="small">• Location while tracking is on: processed on your phone to detect trips. Raw GPS samples are kept on the device only while a trip is in progress, then deleted. Only the trip summary and (rounded) start/end points are saved.</T>
        )}
        <T variant="small">• Place names you type: shown in your trip list and, if you use the assistant, included as trip labels in its answers. They are not sent to any mapping service.</T>
        <T variant="small">• Preferences and goals: to personalise reports and suggestions.</T>
        <T variant="small">• Account email (only with an account): for sign-in.</T>
        <T variant="small">• AI assistant: stored server-side are only run metadata (time, tools used, duration, token counts) for rate limiting and reliability. Questions and answers are not stored by EcoMove.</T>
      </Card>

      <Card>
        <T variant="title">Where your data is kept</T>
        {isWeb ? (
          <>
            <T variant="small">• Without an account: only in this browser's site storage (IndexedDB) on this device. It is not backed up; clearing site data or uninstalling the web app deletes it.</T>
            <T variant="small">• With an account: a copy is kept in this browser so the app works offline, and changes sync to your account when online. Signing out removes the local copy.</T>
            <T variant="small">• The offline cache (service worker) stores only the app's own code, fonts and images — never your trips, your session or AI answers.</T>
          </>
        ) : (
          <T variant="small">• On this phone in the app's private database; with an account also on the EcoMove backend.</T>
        )}
      </Card>

      <Card>
        <T variant="title">Third parties that may receive data</T>
        <T variant="small">• Supabase (only with an account): hosts the database and authentication. Access is restricted per user by row-level security.</T>
        <T variant="small">
          • AI provider (Google Gemini API by default, only when you use the assistant): receives your question and summarised trip data needed to answer it — never GPS traces or coordinates. On Google's free tier, Google states that submitted content may be used to improve its products and may be reviewed by people; do not include sensitive personal details in questions. The paid tier does not use content this way.
        </T>
        {isWeb ? (
          <T variant="small">• Cloudflare Pages: delivers the website files. Like any web host it sees your IP address and browser details when you load the site; your trips are not sent to it.</T>
        ) : (
          <T variant="small">• Apple / Google: deliver notifications you enabled and operating-system location services, under their own policies.</T>
        )}
      </Card>

      <Card>
        <T variant="title">Your rights and controls</T>
        <T variant="small">{isWeb ? '• The website works without location access; trips are always entered manually.' : '• Tracking is opt-in and can be paused or stopped at any time; the app works without location access.'}</T>
        <T variant="small">• Delete individual trips, all trips, or your whole account in the app.</T>
        <T variant="small">• Export all your trips as JSON or CSV.</T>
        <T variant="small">
          {isWeb
            ? '• Traffic to the website and backend uses HTTPS. Your sign-in session is kept in this browser until you sign out.'
            : '• Network traffic to the backend uses HTTPS. Session tokens are stored in the iOS Keychain / Android Keystore.'}
        </T>
        <T variant="small">This notice describes how the app works. It is not a certification of compliance with any specific privacy law; such compliance has not been formally assessed.</T>
      </Card>
    </Screen>
  );
}
