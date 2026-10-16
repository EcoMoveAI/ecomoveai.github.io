# Notes for AI coding agents and contributors

* The primary deliverable is a **PWA** built from Expo Router + react-native-web (`npm run build:web` → `dist/` for Cloudflare Pages). The same source still builds the native app. Read [docs/MIGRATION_REPORT.md](docs/MIGRATION_REPORT.md) first.
* Expo SDK 57 / React Native 0.86. Expo APIs change between SDKs: check `https://docs.expo.dev/versions/v57.0.0/` rather than relying on memory. Install native packages with `npx expo install <pkg>`.
* Routes live in `src/app/` (Expo Router; they are also the website URLs). Non-route code lives in `src/`. `index.ts` imports the background location task **before** `expo-router/entry` and starts the PWA runtime; keep it that way.
* Platform differences go in `*.web.ts(x)` files next to the native file, with the same exports (the typecheck only sees the native file, so keep signatures identical). Do not use `Alert.alert` for confirmations — use `ui/dialogs.ts` (`Alert` is a no-op in browsers).
* Domain logic lives in `supabase/functions/_shared/core/` and is shared by the app (`@core/*`), the Edge Functions (Deno) and the tests. It must stay free of platform APIs and npm dependencies, use explicit `.ts` import extensions, and use only erasable TypeScript syntax (no constructor parameter properties or enums), so Node and Deno can run it directly.
* Never let the LLM compute emissions. Add or extend deterministic tools in `core/agent/tools.ts` instead. LLM vendors go behind `LLMProvider` in `supabase/functions/_shared/llm/` (Gemini is the default).
* Secrets (`GEMINI_API_KEY`, Maps key, service role) belong only in Supabase function secrets. Frontend config is `EXPO_PUBLIC_*` only and is public.
* The service worker must never cache API responses, trips or sessions (no `runtimeCaching` in `scripts/build-web.mjs`). Keep `public/index.html` free of inline scripts (CSP in `public/_headers`).
* Emission factors: never change an existing factor's value. Add a new ID, bump the set version, run `npm run gen:factor-seed`, and update `docs/METHODOLOGY.md` and the pinned-value test.
* Do not edit `android/` or `ios/`; configure native behaviour in `app.json`.
* Before finishing: `npm run typecheck`, `npm run lint`, `npm test`; for web changes also `npm run build:web` (and `npm run preview:web` + `npm run test:pwa`).
