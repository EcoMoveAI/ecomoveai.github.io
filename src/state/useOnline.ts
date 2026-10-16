import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Connectivity as reported by the browser (`navigator.onLine`). On native the app does not track
 * connectivity and this is always true; failed requests are handled where they happen.
 * `onLine === true` only means a network exists, not that Supabase is reachable.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(browserOnline);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const update = () => setOnline(browserOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
