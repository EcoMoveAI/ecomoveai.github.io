import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { isCloudConfigured } from '@/config';
import { applyUpdate, usePwa } from '@/services/pwa';
import { AppProvider, useApp } from '@/state/AppProvider';
import { resumeIfEnabled } from '@/tracking/tracker';
import { Banner, Button } from '@/ui/components';
import { spacing, usePalette } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Navigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Navigator() {
  const scheme = useColorScheme();
  const c = usePalette();
  const { ready, settings, session } = useApp();
  const segments = useSegments();
  const router = useRouter();
  const resumed = useRef(false);
  const pwa = usePwa();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // Route guard: onboarding first; cloud mode requires a session.
  useEffect(() => {
    if (!ready) return;
    const first = segments[0] as string | undefined;
    const inOnboarding = first === 'onboarding';
    const inAuth = first === 'auth';
    // Privacy notice and methodology must be readable before consenting.
    const publicInfo = first === 'privacy' || first === 'methodology';
    if (!settings.onboardingComplete) {
      if (!inOnboarding && !inAuth && !publicInfo) router.replace('/onboarding');
      return;
    }
    if (settings.accountMode === 'cloud' && isCloudConfigured && !session && !inAuth) {
      router.replace('/auth');
    }
  }, [ready, settings.onboardingComplete, settings.accountMode, session, segments, router]);

  useEffect(() => {
    if (ready && settings.onboardingComplete && !resumed.current) {
      resumed.current = true;
      resumeIfEnabled().catch(() => undefined);
    }
  }, [ready, settings.onboardingComplete]);

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: c.primary, background: c.bg, card: c.surface, text: c.text, border: c.border } };

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {pwa.updateReady ? (
        <View style={{ padding: spacing.sm, backgroundColor: c.bg }}>
          <Banner tone="info" icon="refresh" title="A new version of EcoMove is available" action={<Button title="Reload to update" variant="ghost" onPress={applyUpdate} />} />
        </View>
      ) : null}
      <Stack screenOptions={{ headerBackTitle: 'Back', headerTintColor: c.primary, headerTitleStyle: { color: c.text } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ title: 'Account' }} />
        <Stack.Screen name="tracking" options={{ title: 'Trip detection' }} />
        <Stack.Screen name="trip/new" options={{ title: 'Add trip', presentation: 'modal' }} />
        <Stack.Screen name="trip/[id]" options={{ title: 'Trip details' }} />
        <Stack.Screen name="goals" options={{ title: 'Goals' }} />
        <Stack.Screen name="scenario" options={{ title: 'What-if scenarios' }} />
        <Stack.Screen name="preferences" options={{ title: 'Preferences' }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy & data controls' }} />
        <Stack.Screen name="methodology" options={{ title: 'Methodology & sources' }} />
        <Stack.Screen name="data" options={{ title: 'Export & delete' }} />
      </Stack>
    </ThemeProvider>
  );
}
