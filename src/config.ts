/**
 * Public, non-secret configuration. Only `EXPO_PUBLIC_*` variables are bundled into the app and the
 * website — anyone can read them. Never put the Gemini (or any LLM) key, the Maps key or the Supabase
 * service-role key here: those live only in Supabase Edge Function secrets.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
/** Supabase publishable key (`sb_publishable_…`). The legacy anon key name is still accepted. */
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

/** True when a Supabase project is configured (accounts, cloud sync, AI assistant). */
export const isCloudConfigured = /^https:\/\//.test(SUPABASE_URL) && SUPABASE_PUBLISHABLE_KEY.length > 20;

/**
 * Web sub-path the site is served from ('' at a domain root, '/ecomove' on GitHub Pages). Used for files
 * outside the router (service worker, sql.js, icons) and auth redirects; Expo Router applies it to routes.
 */
export const BASE_PATH = (process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');

export const PRIVACY_NOTICE_VERSION = '2026-10-11';
export const APP_NAME = 'EcoMove AI';
