import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { isCloudConfigured } from '@/config';
import { authRedirectUrl, supabase } from '@/services/supabase';
import { useApp } from '@/state/AppProvider';
import { trackingSupported } from '@/tracking/tracker';
import { Banner, Button, Field, Screen, Segmented, T } from '@/ui/components';

export default function AuthScreen() {
  const router = useRouter();
  const { updateSettings, session } = useApp();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  // Web: arriving from the email-confirmation link signs the user in via the URL; finish onboarding.
  const finished = useRef(false);
  useEffect(() => {
    if (!session || !isCloudConfigured || finished.current) return;
    finished.current = true;
    void updateSettings({ accountMode: 'cloud', onboardingComplete: true }).then(() => router.replace(trackingSupported ? '/tracking' : '/'));
  }, [session, updateSettings, router]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!isCloudConfigured || !supabase) {
    return (
      <Screen>
        <Banner tone="info" icon="cloud-offline" title="Accounts are not available" body="This build has no backend configured. Use on-device mode instead." />
        <Button
          title={Platform.OS === 'web' ? 'Use without an account' : 'Use on this device'}
          onPress={async () => {
            await updateSettings({ accountMode: 'local', onboardingComplete: true });
            router.replace('/');
          }}
        />
      </Screen>
    );
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = password.length >= 8;

  async function submit() {
    if (!supabase) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirectUrl() } });
        if (e) throw e;
        if (!data.session) {
          setInfo('Check your email to confirm your account, then sign in.');
          setMode('signin');
          return;
        }
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw e;
      }
      await updateSettings({ accountMode: 'cloud', onboardingComplete: true });
      router.replace(trackingSupported ? '/tracking' : '/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <T variant="h2">{mode === 'signin' ? 'Sign in' : 'Create your account'}</T>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'signin', label: 'Sign in' }, { value: 'signup', label: 'Create account' }]} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          textContentType={mode === 'signup' ? 'newPassword' : 'password'}
          hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
        />
        {error ? <Banner tone="danger" icon="alert-circle" title="Could not continue" body={error} /> : null}
        {info ? <Banner tone="info" icon="mail" title="Almost there" body={info} /> : null}
        <Button title={mode === 'signin' ? 'Sign in' : 'Create account'} onPress={submit} loading={busy} disabled={!emailValid || !passwordValid} />
        <Button
          title={Platform.OS === 'web' ? 'Use without an account instead' : 'Use on this device instead'}
          variant="ghost"
          onPress={async () => {
            await updateSettings({ accountMode: 'local', onboardingComplete: true });
            router.replace('/');
          }}
        />
        <T variant="small" muted>
          {Platform.OS === 'web'
            ? 'Your session is kept in this browser until you sign out. On a shared computer, sign out when you are done. Passwords are handled by Supabase Auth and never stored by EcoMove.'
            : 'Your session is stored in the device keychain/keystore. Passwords are handled by Supabase Auth and never stored by the app.'}
        </T>
      </Screen>
    </KeyboardAvoidingView>
  );
}
