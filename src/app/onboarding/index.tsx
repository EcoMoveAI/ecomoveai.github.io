import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Platform, View } from 'react-native';
import { Button, Card, Row, Screen, T, type IconName } from '@/ui/components';
import { spacing, usePalette } from '@/ui/theme';

const POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'analytics', title: 'See your mobility footprint', body: 'Daily, weekly, monthly and yearly CO₂e estimates from the trips you record.' },
  { icon: 'document-text', title: 'Transparent methodology', body: 'Every number shows its formula, emission factor, accounting boundary and source.' },
  { icon: 'sparkles', title: 'An assistant grounded in your data', body: 'Ask why your footprint changed or simulate switching modes — answers come from tools, not guesses.' },
  Platform.OS === 'web'
    ? { icon: 'shield-checkmark', title: 'Private by design', body: 'The website never tracks your location: you add trips yourself, and you can export or delete everything.' }
    : { icon: 'shield-checkmark', title: 'Private by design', body: 'Tracking is opt-in, trip detection runs on your phone, and you can export or delete everything.' },
];

export default function Welcome() {
  const router = useRouter();
  const c = usePalette();
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl }}>
        <Ionicons name="leaf" size={56} color={c.primary} />
        <T variant="h1">EcoMove AI</T>
        <T muted style={{ textAlign: 'center' }}>Understand and reduce the carbon footprint of your everyday travel — without guilt trips.</T>
      </View>
      {POINTS.map((p) => (
        <Card key={p.title}>
          <Row style={{ alignItems: 'flex-start' }}>
            <Ionicons name={p.icon} size={24} color={c.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="body" style={{ fontWeight: '700' }}>{p.title}</T>
              <T variant="small" muted>{p.body}</T>
            </View>
          </Row>
        </Card>
      ))}
      <Button title="Get started" onPress={() => router.push('/onboarding/privacy')} />
    </Screen>
  );
}
