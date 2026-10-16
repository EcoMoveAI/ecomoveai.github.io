/**
 * Supabase auth storage backed by expo-secure-store (iOS Keychain / Android Keystore-encrypted storage).
 * SecureStore values are size-limited, so long session JSON is split into chunks.
 */
import * as SecureStore from 'expo-secure-store';

const CHUNK = 1800;
const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const base = safeKey(key);
    const count = await SecureStore.getItemAsync(`${base}.n`);
    if (count == null) return SecureStore.getItemAsync(base);
    const parts: string[] = [];
    for (let i = 0; i < Number(count); i++) {
      const p = await SecureStore.getItemAsync(`${base}.${i}`);
      if (p == null) return null;
      parts.push(p);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const base = safeKey(key);
    await this.removeItem(key);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) await SecureStore.setItemAsync(`${base}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${base}.n`, String(n));
  },
  async removeItem(key: string): Promise<void> {
    const base = safeKey(key);
    const count = await SecureStore.getItemAsync(`${base}.n`);
    if (count != null) {
      for (let i = 0; i < Number(count); i++) await SecureStore.deleteItemAsync(`${base}.${i}`);
      await SecureStore.deleteItemAsync(`${base}.n`);
    }
    await SecureStore.deleteItemAsync(base);
  },
};
