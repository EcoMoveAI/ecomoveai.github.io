# Migration report: native app → installable PWA (v0.1.0 → v0.2.0)

*Written 2026-10-11. It compares the original EcoMove AI architecture with the result of the migration, explains the decisions, and lists what was preserved, adapted, replaced and removed. Test evidence is in [TESTING.md](TESTING.md).*

## 1. Summary

EcoMove AI was an Expo / React Native app for Android and iOS, with an offline SQLite store, optional Supabase sync, and a tool-using assistant (Anthropic). It is now delivered **primarily as a responsive, installable Progressive Web App** hosted on Cloudflare Pages. It uses Supabase for auth, Postgres, RLS and Edge Functions, and **Google Gemini** through the `mobility-assistant` Edge Function.

The product, screens, visual design, calculation engine, emission factors, analytics, goals, scenarios and agent tools are **the same code** as before. The architecture and delivery platform changed; the product did not. The native build still compiles from the same source (`expo export --platform android` was verified after the migration).

## 2. Original vs. resulting architecture

| Layer | Before (v0.1, native) | After (v0.2, PWA) |
|---|---|---|
| Delivery | EAS-built APK/IPA, or Expo Go | **Static PWA on Cloudflare Pages** (HTTPS, installable); native builds still possible |
| UI framework | React 19 + React Native 0.86 | Same components, rendered to the DOM by **react-native-web** (React DOM) |
| Language | TypeScript | TypeScript |
| Build system | Metro (Expo CLI) | Metro web export (`expo export --platform web`, single-page output) + Workbox |
| Routing | Expo Router (file-based) | **Same Expo Router routes**, as browser URLs with deep links and refresh support |
| Local storage | expo-sqlite (device SQLite) | **sql.js (SQLite/WASM) persisted to IndexedDB**, same schema and `Repository` |
| Offline sync | Pending queue → `sync_push_trips` RPC, LWW, tombstones | **Unchanged**, plus an immediate retry when the browser comes back online |
| Auth session | Keychain/Keystore (expo-secure-store) | `localStorage` on the web (removed on sign-out); Keychain/Keystore on native |
| Database | Supabase Postgres + RLS | **Unchanged schema** (no new migrations needed) |
| Assistant | `agent` function → Anthropic SDK | **`mobility-assistant` function → Gemini REST provider** (Anthropic kept as an alternative) |
| Routes | `routes` function → Google Routes API | Unchanged, plus CORS for browsers |
| Location tracking | Foreground and background GPS detection | **Not available on the web** (explained in the app); native only |
| Notifications | expo-notifications local schedules | Browser Notification API; due reminders shown when the site is opened |
| Export | Share sheet (JSON/CSV) | Browser download (JSON/CSV) **plus JSON import** |

### Why Expo web rather than a Vite rewrite

The migration brief prefers React + TypeScript with Vite, unless the project has a documented reason to keep a compatible alternative. This project has one:

* **The whole UI is React Native code**: 21 route files plus shared components built on `View`, `Text` and `Pressable`. Porting it to a Vite + React DOM app would have meant **rewriting every screen**, which goes against "do not redesign" and "preserve components". react-native-web renders the existing components as accessible HTML in the browser, so the interface stays the same, and that is the officially supported path for Expo projects.
* **Expo Router is the "existing compatible routing solution".** Every route keeps its URL (`/`, `/trips`, `/insights`, `/trip/:id` …).
* **One codebase stays buildable for Android and iOS**, so automatic trip detection is still available to anyone who installs the native app.
* Metro plays the role Vite would. The output is plain static files (`dist/`) that Cloudflare Pages serves like any Vite build.

Environment variables therefore use Expo's public prefix, **`EXPO_PUBLIC_`**, instead of `VITE_`. The rule is the same: these values are bundled into the website and must not be secret. The names used are `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The server secret is `GEMINI_API_KEY`, stored only in Supabase.

## 3. What was preserved, adapted, replaced and removed

### Preserved (unchanged code)

* `supabase/functions/_shared/core/**`: the calculation engine, the versioned emission factors (ecomove-tw-hybrid v2026.10-1 and DESNZ 2025), trips, time zones, analytics, insights, scenarios, goals, detection, classification, routing and the **10 agent tools**. No factor values or calculation rules changed.
* `src/db/repository.ts` (schema, queries), `src/sync/**` (sync engine and conflict rules), `src/ui/charts.tsx`, `TripRow`, the theme (colours, typography, spacing) and nearly all of `components.tsx`.
* All screens and the navigation hierarchy: 5 tabs (Home, Trips, Insights, AI Assistant, Profile), plus Add/Edit trip, Goals, What-if scenarios, Preferences, Privacy, Methodology, and Export & delete.
* The database: migrations, RLS policies, RPCs and the factor seed.
* The existing tests: all 112 Jest tests and 16 database tests still run and pass. Three were adjusted (`anthropic.test.ts` for the new provider selection, and the `sqljsDriver` helper, which now uses the production web adapter).

### Adapted for the browser

| Item | Change |
|---|---|
| Storage | New `src/db/webDriver.ts` and `shared.web.ts`: SQLite in WebAssembly, saved to IndexedDB after each write, with change notifications across tabs |
| Layout | Content column capped at 760 px on large screens; on screens ≥ 900 px the bottom tab bar becomes a **side rail** (same tabs, icons and colours) |
| Date/time input | `DateTimeField.web.tsx` uses the browser's `datetime-local` picker (native pickers unchanged) |
| Confirmation dialogs | `Alert.alert` does nothing in browsers, so a new `ui/dialogs.ts` uses `window.confirm` on the web. This affected deleting trips, goals and all data, deleting the account, signing out and switching methodology |
| Session storage | `secureStorage.web.ts` (localStorage) |
| Export | `exportData.web.ts` downloads the file. The format is shared in `exportFormat.ts` |
| Notifications | `notifications.web.ts`: permission prompt, goal notifications, and reminders delivered when the site is next opened (`services/reminders.ts`) |
| Copy | Text mentioning phones, GPS or "this device" changes to browser wording on the web (onboarding, privacy notice, profile, data screen) |
| Sign-in | Email confirmation returns to `/auth` on the site (`emailRedirectTo`), and the session is picked up from the URL |
| Sign-out | Now **refuses to sign out while changes are not uploaded**. Previously, signing out offline could delete unsynced trips. This applies to native as well |
| Edge Functions | CORS for browser origins (`ALLOWED_ORIGINS`), `Cache-Control: no-store`, and per-request headers |

### Replaced

* **AI provider: Anthropic → Gemini** (`_shared/llm/gemini.ts`, REST `generateContent` with function calling). It sits behind the same `LLMProvider` interface. `LLM_PROVIDER=anthropic` still works, and adding another provider means writing one file plus one `case` in `_shared/llm/index.ts`.
* **Edge Function `agent` → `mobility-assistant`.** The same request flow, now with stricter message validation and an `errorKind` field (quota, rate limit, auth, timeout, unavailable) that drives the in-app fallback messages.

### Added

* PWA: `public/manifest.webmanifest`, icons generated from the app's own leaf glyph and brand green (`scripts/gen-pwa-icons.ps1`), `public/index.html` template, Workbox service worker, update prompt ("A new version is available"), install card in Profile, and `public/_headers` (CSP, Permissions-Policy, caching).
* An offline banner on Home and in the Assistant; Profile and Trips show sync status; sync retries automatically when the browser reconnects.
* **Data import** (`services/importData.ts`) to migrate trips recorded in the mobile app. It validates every record, keeps each trip's original factor and methodology snapshot, never overwrites newer local records, and is idempotent (stable UUIDs plus dedupe keys).
* Build verification (`scripts/build-web.mjs`), a local production preview (`scripts/serve-dist.mjs`) and an end-to-end PWA check in headless Edge or Chrome (`scripts/pwa-smoke.mjs`).
* Tests: `gemini.test.ts` (12), `web.test.ts` (13), `request.test.ts` (6).

### Removed or unavailable on the web (still in the native build)

| Feature | Web status | Reason and alternative |
|---|---|---|
| Automatic trip detection (GPS) | **Not offered** | Browsers cannot receive locations while the page is closed or in the background, and an installed PWA cannot either. A "keep the tab open" imitation would be unreliable and drain the battery. The website never asks for location (`Permissions-Policy: geolocation=()`). Manual entry is the main workflow, and detected trips can be imported from the native app |
| Scheduled notifications while closed | **Partial** | True scheduled pushes would need Web Push (VAPID keys plus a scheduled sender), which is not included. Due reminders are shown when EcoMove is opened, and the in-app summaries are always available |
| "Store precise endpoints" toggle | Hidden on web | It only applies to GPS-detected trips |
| Keychain/Keystore session storage | Not available | The browser equivalent is localStorage. The sign-in screen tells users on shared computers to sign out |

## 4. Data migration

* **Server data.** The schema is unchanged, so `supabase db push` on an existing v0.1 database applies nothing new and keeps all rows. The v0.1 backend had not been deployed yet, so no production data needed transforming.
* **Phone-only data** (on-device mode). In the mobile app, use **Export as JSON**, then on the website **Profile → Import, export & delete → Import a JSON export**. Imported trips keep their IDs, sources (manual or auto) and calculation snapshots. With an account, they are then uploaded through the normal sync queue.
* **Browser-only data** (no account). To move it to an account, sign in in the same browser. Pending local records sync automatically. Alternatively, export and import JSON.

## 5. Security review of the migration

* The bundle contains only `EXPO_PUBLIC_SUPABASE_URL` and the publishable key. The build fails if it finds Google, Anthropic or Supabase secret patterns or a service-role JWT.
* `GEMINI_API_KEY` is read only inside the Edge Function and sent only in the `x-goog-api-key` header to Google (a test checks it never appears in a URL).
* Authorization does not depend on the model. The function verifies the JWT and queries through a client carrying the caller's JWT, so RLS limits every read to the caller's own rows. Tools accept no user IDs, table names or SQL, and the arguments in each model call are validated against a JSON schema before running. The loop is bounded: at most 8 steps, a 100 s deadline, a 15 s timeout per tool, and an hourly per-user limit.
* The LLM receives place labels, kilometres and kilograms, never coordinates or GPS traces. Only run metadata is stored (`agent_runs`).
* The service worker precaches only same-origin static files. Supabase and Gemini requests are never cached, and neither are trips or sessions. Trips live in IndexedDB, which is private to the site's origin and the browser profile.

## 6. Remaining work and limitations

See [STATUS.md](STATUS.md). The most important items:

1. Deploy Supabase and the functions, set `GEMINI_API_KEY`, and connect Cloudflare Pages. These steps need the user's own accounts ([DEPLOY_WEB.md](DEPLOY_WEB.md)).
2. **A live Gemini call has not been made.** The provider is tested against mocked HTTP that follows the documented API.
3. Test the site on real phones (iOS Safari install, Android Chrome install and offline use) and run a screen-reader pass.
4. Web Push for scheduled reminders, if needed later.
5. Taiwan road-mode factors are still UK proxies awaiting MOENV verification. This is unchanged by the migration and disclosed in the app.
