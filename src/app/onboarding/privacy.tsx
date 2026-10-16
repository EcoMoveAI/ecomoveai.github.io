import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Switch, View } from 'react-native';
import { PRIVACY_NOTICE_VERSION } from '@/config';
import { useApp } from '@/state/AppProvider';
import { Button, Card, Row, Screen, T } from '@/ui/components';
import { usePalette } from '@/ui/theme';

const isWeb = Platform.OS === 'web';

export default function PrivacyConsent() {
  const router = useRouter();
  const { updateSettings } = useApp();
  const c = usePalette();
  const [agreed, setAgreed] = useState(false);

  return (
    <Screen edges={['top', 'bottom']}>
      <T variant="h2">Your data, your choice</T>
      <Card>
        <T variant="body" style={{ fontWeight: '700' }}>What EcoMove stores</T>
        <T variant="small">• Trips: times, distance, transport mode, estimated CO₂e and the emission factor used.</T>
        {isWeb ? (
          <T variant="small">• Start/end points only as place names you type (optional).</T>
        ) : (
          <>
            <T variant="small">• Start/end points only as place names you type, or coordinates rounded to about 110 m (you can change this).</T>
            <T variant="small">• Raw GPS points stay on your phone only while a trip is in progress and are deleted when it ends.</T>
          </>
        )}
      </Card>
      <Card>
        {isWeb ? (
          <>
            <T variant="body" style={{ fontWeight: '700' }}>No location tracking on the website</T>
            <T variant="small">The website does not ask for or use your location. You record trips by entering them. Automatic trip detection exists only in the EcoMove mobile app.</T>
          </>
        ) : (
          <>
            <T variant="body" style={{ fontWeight: '700' }}>Location tracking is optional</T>
            <T variant="small">Automatic trip detection is off until you turn it on. You can always enter trips manually instead. You can pause or stop tracking at any time.</T>
          </>
        )}
      </Card>
      <Card>
        <T variant="body" style={{ fontWeight: '700' }}>Who else receives data</T>
        <T variant="small">{isWeb ? '• Without an account: nobody — data stays in this browser on this device (and is not backed up).' : '• On-device mode: nobody — data stays on this phone.'}</T>
        <T variant="small">• With an account: trips sync to the EcoMove backend (Supabase). AI assistant questions and summarised trip data (no GPS traces or coordinates) are sent to the configured AI provider (Google Gemini by default).</T>
        <T variant="small">• EcoMove never sells your data. On Gemini's free tier, Google may use assistant questions and answers to improve its products — see the full notice before using the assistant.</T>
      </Card>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: agreed }} onPress={() => setAgreed(!agreed)}>
        <Row>
          <Switch value={agreed} onValueChange={setAgreed} trackColor={{ true: c.primary }} accessibilityLabel="I have read the privacy summary" />
          <View style={{ flex: 1 }}>
            <T variant="small">I have read this summary and the full privacy notice (available any time under Profile → Privacy).</T>
          </View>
        </Row>
      </Pressable>
      <Button
        title="Continue"
        disabled={!agreed}
        onPress={async () => {
          await updateSettings({ privacyConsentVersion: PRIVACY_NOTICE_VERSION });
          router.push('/onboarding/account');
        }}
      />
      <Button title="Read the full privacy notice" variant="ghost" onPress={() => router.push('/privacy')} />
    </Screen>
  );
}
