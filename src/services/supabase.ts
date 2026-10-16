import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { BASE_PATH, isCloudConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/config';
import { secureSessionStorage } from './secureStorage';

const isWeb = Platform.OS === 'web';

/** Null when the app runs in on-device mode without a configured backend. */
export const supabase: SupabaseClient | null = isCloudConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      // On the web, the email-confirmation link returns to the site with the session in the URL.
      auth: { storage: secureSessionStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: isWeb },
    })
  : null;

/** Where Supabase Auth sends users after they confirm their email (web: this site; native: default). */
export function authRedirectUrl(): string | undefined {
  return isWeb && typeof window !== 'undefined' ? `${window.location.origin}${BASE_PATH}/auth` : undefined;
}

if (supabase && !isWeb) {
  // Refresh tokens only while the app is in the foreground (recommended for React Native).
  // Browsers manage this themselves through the visibility API inside supabase-js.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
