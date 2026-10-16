# Testing EcoMove AI

## Commands

```bash
npm test
```

Runs the Jest suites and then the database suite.

```bash
npm run test:unit
```

```bash
npm run test:db
```

```bash
npm run typecheck
```

```bash
npm run lint
```

Production web build (fails on missing PWA files, a `404.html`, inline scripts or secret-looking values):

```bash
npm run build:web
```

End-to-end PWA check in headless Edge/Chrome against the local preview (start `npm run preview:web` first):

```bash
npm run test:pwa
```

## Last verified run (2026-10-11, Windows 11, Node 24.20.0)

| Check | Result |
|---|---|
| `jest` | **14 suites, 143 tests passed** (112 pre-migration + 31 new) |
| `node --test __tests__/db/rls.test.mts` | **16 tests passed** |
| `tsc --noEmit` (app + tests) and `tsc -p tsconfig.functions.json` (Edge Functions) | No errors |
| `eslint .` | No errors or warnings |
| `npm run build:web` | Built and verified; service worker precaches 31 files (2.8 MB); no secrets found |
| `npm run test:pwa` (headless Microsoft Edge, production build served with the Cloudflare headers incl. CSP) | **11/11 checks passed** |
| Manual check in the in-app Chromium browser | Onboarding, add trip with `datetime-local`, trip details, reload of a nested URL, delete with confirm dialog, Insights at 1280 px (side rail) and Trips at 375 px |
| `expo export --platform android` | Native bundle still builds after the migration |

The in-app preview browser of the development environment refuses service-worker registration ("unknown error when fetching the script"); the service worker was therefore verified in headless Edge, where it installs normally.

## What is covered

### Unit tests (`__tests__/core`)

| Area | File |
|---|---|
| Carbon calculations (pkm/vkm, occupancy, zero-emission convention, unavailable factors, precision, display rounding) | `calc.test.ts` |
| Invalid input rejection (negative, NaN, ∞, > 1,500 km, bad occupancy, unknown mode) | `calc.test.ts`, `trips-goals.test.ts` |
| Emission-factor integrity (source URL, reference, unit validity, unique IDs, pinned verified values, default variants, boundary grouping) | `factors.test.ts` |
| Time zones and reporting periods (local day assignment, ISO weeks, month/year boundaries, DST 23/25-hour days, period keys) | `time.test.ts` |
| Elapsed-period comparisons (month-to-date vs. same days, short-month clamping, complete past periods) | `time.test.ts`, `analytics.test.ts` |
| Daily/monthly aggregation, % change, no-baseline handling, contributors, mixed versions/boundaries, series, averages | `analytics.test.ts` |
| Insights wording (association, not causation; empty state) | `analytics.test.ts` |
| Scenario simulations and mode comparison (no mutation of history, share, multiplier, filters, validation) | `scenario.test.ts` |
| Trip detection (start/stop, resumable batches, noise/jump/duplicate filtering, OS gap, flush), classification confidence, duplicate detection | `tracking.test.ts` |
| Trip construction, editing and recalculation, dismissal, goals | `trips-goals.test.ts` |

### Integration tests

| Area | File | How |
|---|---|---|
| Database schema, constraints, RLS, sync RPC (LWW, idempotency, dedupe key, tombstones), `delete_my_data`, cascading account deletion, seed matches dataset | `__tests__/db/rls.test.mts` | Real migrations in **PGlite** (PostgreSQL compiled to WASM) with stand-ins for Supabase's `auth` schema and roles, executed as two different users |
| AI tool validation and authorisation surface (no user/SQL params, bad args rejected before data access), no coordinates sent to the LLM, tool failures/timeouts | `__tests__/agent/agent.test.ts` | In-memory data port |
| Agent loop calling calculation and analytics services (multi-tool turns, tool errors returned to the model, LLM outage, refusal, step limit, history sanitising) | `__tests__/agent/agent.test.ts` | Scripted mock `LLMProvider` |
| **Gemini provider**: 10 function declarations, schema conversion, key only in header, function-call round trip with `thoughtSignature` preserved, invalid model arguments rejected before execution, fallback model on quota, quota/rate/auth/timeout classification, 503 retry, safety refusals, no execution of truncated calls, env configuration | `__tests__/agent/gemini.test.ts` | Mocked REST responses following the documented `generateContent` format (no real API calls) |
| Anthropic provider request shape (tools, cached system prompt, effort, server fallbacks, append-only history, tool results), error handling | `__tests__/agent/anthropic.test.ts` | Official SDK with a mocked `fetch` (no real API calls) |
| Edge Function HTTP layer: CORS (`ALLOWED_ORIGINS`), preflight, missing bearer token → 401, body size/JSON limits, no internal error leakage | `__tests__/agent/request.test.ts` | Deno env shim |
| Web: JSON import validation and migration semantics, browser reminder timing, sql.js storage adapter (persist-on-write, transaction serialisation/rollback), manifest validity, CSP/headers, no runtime caching, frontend reads only `EXPO_PUBLIC_*` | `__tests__/app/web.test.ts` | Node, real files |
| Routing provider parsing and error handling | `__tests__/agent/agent.test.ts` | Mocked Google Routes responses |
| Local persistence, pipeline (detect → classify → dedupe → calculate → save), offline queue, retry after failure, multi-device sync, LWW, deletion propagation | `__tests__/app/offline.test.ts` | Real `Repository` on **sql.js** (SQLite in WASM) + `FakeRemote` with the server's conflict rules |
| Mobile UI flows: onboarding & consent, permission denial, manual trip entry with live preview, dashboard, review/correct an automatic trip, empty states | `__tests__/app/screens.test.tsx` | Real Expo Router app rendered with `expo-router/testing-library`; native modules mocked |

Mock providers live only under `__tests__/` and are never imported by production code.

### Browser / PWA end-to-end (`scripts/pwa-smoke.mjs`)

Runs the production build in headless Edge/Chrome via the DevTools protocol: manifest parsed with no installability errors · service worker active · precache holds index.html, the JS bundle and the sql.js WASM, and only same-origin static files · onboarding → dashboard · manual trip saved with calculation trace · trip persists across reload (IndexedDB) · with the network **offline**: app shell loads, a trip deep link loads with local data, the add-trip form works.

## Tests requiring live credentials (not run here)

| # | Check | How |
|---|---|---|
| L1 | Sign-up, email confirmation redirect, sign-in on the deployed site | DEPLOY_WEB.md §5 |
| L2 | Sync: add/edit/delete in two browsers on one account; offline edit then reconnect | Expect LWW result in both; no duplicates |
| L3 | RLS from the browser: user B cannot read user A's trips (try `supabase.from('trips').select()` in the console as B) | Empty result |
| L4 | Assistant with a real `GEMINI_API_KEY`: the three example questions (period comparison, taxi→MRT scenario, lowest-carbon route) | Answers cite tool results; route question says routing is unavailable unless `GOOGLE_MAPS_API_KEY` is set |
| L5 | Assistant without a key / with an exhausted quota | "not configured" / "usage quota" message; Insights still work |
| L6 | Edge Function auth: call `mobility-assistant` without a token or with another project's token | 401 |
| L7 | Install on iPhone (Safari → Add to Home Screen) and Android (Chrome → Install); airplane mode → reopen → add trip → reconnect | Opens offline; trip syncs after reconnect |
| L8 | Screen-reader pass (VoiceOver/TalkBack/NVDA) on Home, Add trip, Insights | Labels announced; focus order sensible |

## Not covered by automated tests (native app, requires real devices)

Simulators and unit tests **cannot** establish reliable background location behaviour. Before relying on automatic tracking, run this plan on at least one Android phone (ideally Samsung or Xiaomi as well as Pixel) and one iPhone, using a development or preview build:

| # | Scenario | Expected |
|---|---|---|
| D1 | Fresh install → onboarding → on-device mode → Trip detection → allow "While using" → Start | Status "Detecting trips (while app is open)" |
| D2 | Allow background ("Always" / "Allow all the time") → Start | Status "Detecting trips (background)"; Android notification visible; iOS blue indicator |
| D3 | Walk 10–15 min with the phone locked, then stay put for 6+ min | One walking trip, auto-confirmed, distance within ±15% of a map measurement |
| D4 | Ride a bus/scooter/car 15+ min | Trip saved as **needs review**; confirming a mode recalculates emissions |
| D5 | Take Taipei MRT including underground sections | Trip detected (possibly with a shorter distance); user can edit the distance |
| D6 | Pause → travel → Resume | No trip recorded while paused |
| D7 | Force-quit the app (iOS) / swipe away (Android) and travel | Document the observed behaviour per device (expected: iOS stops; Android varies by vendor) |
| D8 | Deny location permission | Manual entry, dashboards and insights still work; tracking screen offers settings |
| D9 | Airplane mode: add/edit/delete trips, then reconnect (account mode) | "Not synced" badges, then synced; no duplicates on the server |
| D10 | Two devices on one account: edit the same trip on both | Later edit wins on both after sync |
| D11 | Battery: track for a full day | Record battery drain; target < 5–8% per day with balanced accuracy |
| D12 | Notifications enabled/denied | Generic text only; app works when denied |

Record results (device model, OS version, pass/fail, notes) in a table such as `docs/device-test-results.md`.
