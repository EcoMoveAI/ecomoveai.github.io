/**
 * Web build: Supabase session storage in localStorage (per origin and browser profile). Browsers have no
 * equivalent of the Keychain/Keystore; the session is removed on sign-out. Service-worker caches never
 * contain it. On shared computers users should sign out after use (stated on the sign-in screen).
 */
function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    return store()?.getItem(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    store()?.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store()?.removeItem(key);
  },
};
