# EcoMove AI — Architecture

## Overview

Since v0.2 the primary client is a **PWA** (see [MIGRATION_REPORT.md](MIGRATION_REPORT.md)). The same React / Expo Router source also builds the native Android/iOS app. Platform differences live in `*.web.ts(x)` files, which Metro picks for the web build.

```
┌──────────── Browser (PWA, served as static files by Cloudflare Pages over HTTPS) ───────────────────────────────┐
│  Expo Router screens (src/app) rendered with react-native-web     AppProvider state (src/state)                 │
│        │                                                                                                         │
│  Shared core (@core = supabase/functions/_shared/core): calc · factors · analytics · insights · scenario ·        │
│  trips · goals · time (pure TypeScript, no platform APIs)                                                        │
│        │                                                                                                         │
│  Local SQLite: sql.js (WASM) persisted to IndexedDB ── sync engine (push RPC / pull by cursor) ──┐              │
│  Session: localStorage (supabase-js)     Service worker (Workbox): app shell + static assets only │ HTTPS        │
└───────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────┘
   (Native build: expo-sqlite, Keychain/Keystore, background location task — same screens and core)  │
                                                                                                       ▼
┌────────────────────────────────────────── Supabase ───────────────────────────────────────────────────────────┐
│ Auth · Postgres (RLS on every user table) · RPC sync_push_trips / delete_my_data                               │
│ Edge Functions (Deno):  mobility-assistant ──► orchestrator (@core/agent) ──► 10 tools ──► RLS-scoped queries  │
│                         │                        │                                                             │
│                         │                        └─► LLMProvider: Gemini REST (default) | Anthropic SDK        │
│                         │                            (keys only in function secrets)                           │
│                         routes ──► RouteProvider (Google Routes API; key in function secrets)                  │
│                         delete-account ──► auth.admin.deleteUser (service role, caller's own id only)          │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Why this shape

* **One source of truth for domain logic.** The calculation engine, analytics and agent tools are pure TypeScript in `supabase/functions/_shared/core`. The app imports it through the `@core/*` alias (Metro and Jest resolve explicit `.ts` imports); the Edge Functions import it directly with Deno. The browser, phone and server therefore produce identical numbers.
* **Offline-first.** The app is fully usable without a network or an account. Local SQLite (IndexedDB-backed in the browser) is the local source of truth; Supabase is the authoritative cloud copy when an account is used.
* **No permanently running server.** Static hosting (Cloudflare Pages) plus Supabase Edge Functions for trusted operations.
* **Privileged secrets never ship to the client.** Only the Supabase URL and publishable key (both public, protected by RLS) are bundled. The Gemini/LLM key, the Maps key and the service-role key live in Edge Function secrets, and `scripts/build-web.mjs` fails the build if a secret pattern appears in `dist/`.

### PWA specifics

| Concern | Implementation |
|---|---|
| Build | `expo export --platform web` (`web.output: "single"`), then Workbox `generateSW` → `dist/` |
| Manifest, icons, HTML template | `public/manifest.webmanifest`, `public/icons/*`, `public/index.html` (no inline scripts, compatible with the CSP) |
| Service worker | Precaches same-origin static files (HTML, JS, WASM, fonts, icons). Navigation fallback to `/index.html` makes deep links work offline. **No runtime caching**: Supabase and Gemini requests, trips and sessions are never cached. The update is activated by the user (`SKIP_WAITING` from the "new version" banner) |
| Registration and install prompt | `src/services/pwa.web.ts`, started from `index.ts` so the early `beforeinstallprompt` event is caught |
| SPA routing on Cloudflare | No `404.html` in `dist/`, so Pages serves `index.html` for unknown paths |
| Security headers | `public/_headers`: CSP (`script-src 'self' 'wasm-unsafe-eval'`, `connect-src` Supabase only), `Permissions-Policy: geolocation=()`, HSTS, `X-Frame-Options: DENY` |
| Responsive layout | Content column ≤ 760 px; at ≥ 900 px the tab bar becomes a side rail (`tabBarPosition: 'left'`) |
| Multiple tabs | Writes are saved to IndexedDB and announced on a `BroadcastChannel`; other tabs reload the snapshot |

## Modules

| Concern | Location |
|---|---|
| Domain types, modes | `core/types.ts`, `core/modes.ts` |
| Emission factors (versioned), seed generator | `core/factors.ts`, `core/factorSeed.ts`, `scripts/gen-factor-seed.mts` |
| Deterministic calculation engine | `core/calc.ts` |
| Trip construction, validation, edit/recalculation | `core/trips.ts` |
| Reporting periods & time zones | `core/time.ts` |
| Aggregation and period comparison | `core/analytics.ts` |
| Rule-based insights | `core/insights.ts` |
| Scenario simulation & mode comparison | `core/scenario.ts` |
| Trip detection (state machine), classification, duplicate detection | `core/detection.ts`, `core/classification.ts`, `core/dedupe.ts` |
| Goals | `core/goals.ts` |
| Routing provider interface + Google Routes | `core/routing.ts` |
| Agent tools, schema validation, orchestrator | `core/agent/*.ts` |
| LLM providers and selection | `supabase/functions/_shared/llm/{gemini,anthropic,index}.ts` |
| RLS-scoped agent data access | `supabase/functions/_shared/dataPort.ts` |
| Edge Functions | `supabase/functions/{mobility-assistant,routes,delete-account}/index.ts`; HTTP/CORS/auth helpers in `_shared/request.ts` |
| Schema, RLS, RPCs, factor seed | `supabase/migrations/*.sql` |
| Local persistence | `src/db/repository.ts`; drivers `expoDriver.ts` (native), `webDriver.ts` + `sqljsDriver.ts` (web, also used by tests) |
| Sync | `src/sync/syncEngine.ts`, `supabaseRemote.ts` |
| Location tracking | `src/tracking/{task,pipeline,tracker}.ts` (native); `*.web.ts` report "unsupported" |
| Import/export | `src/services/{exportFormat,exportData(.web),importData,filePicker(.web)}.ts` |
| Notifications | `src/services/notifications(.web).ts`, `reminders.ts` |
| PWA runtime | `src/services/pwa(.web).ts`, `index.ts` |
| App state | `src/state/AppProvider.tsx`, `useOnline.ts` |
| UI | `src/app/**` (routes), `src/ui/**` (components, charts, `DateTimeField(.web)`, `dialogs`) |

## Provider interfaces (replaceable integrations)

| Interface | Implementations | Behaviour when unconfigured |
|---|---|---|
| `LLMProvider` (`core/agent/orchestrator.ts`) | `GeminiProvider` (REST `generateContent` + function calling, default), `AnthropicProvider` (official SDK), scripted mock in tests | `mobility-assistant` returns `503 llm_not_configured`; quota, rate-limit, auth and timeout failures return `status: llm_error` + `errorKind`; the app explains this and points to the deterministic Insights/Scenario screens |
| `RouteProvider` (`core/routing.ts`) | `GoogleRoutesProvider` (Routes API `computeRoutes`), `UnavailableRouteProvider` | Returns `available: false`; the user enters distances manually and the agent says route data is unavailable |
| `RemoteStore` (`src/sync/remoteStore.ts`) | Supabase, `FakeRemote` in tests | No account: no sync |
| `SqlDriver` (`src/db/driver.ts`) | expo-sqlite (native), sql.js + IndexedDB (web), sql.js in memory (tests) | — |
| Activity recognition | Extension point: `TripFeatures.activityHint` | Not connected (no Expo module); classification relies on speed patterns plus user confirmation |
| Emission-factor dataset | `FactorSet` objects (two sets shipped) | — |

Adding another LLM vendor means implementing `LLMProvider.startConversation()` (one turn = `next()`, `addToolResults()`), throwing `LLMProviderError` with a kind for classified failures, and adding a case to `providerFromEnv()` in `_shared/llm/index.ts`.

## Trip lifecycle

1. **Detection (on device).** `expo-location` delivers samples to the TaskManager task (background) or `watchPositionAsync` (foreground). `pipeline.ingestSamples` runs the resumable detector, which ends a trip after 5 minutes stationary or a gap of more than 20 minutes. Raw samples are held only in the in-progress detector state and are cleared when the trip ends.
2. **Classification.** A conservative classifier returns a mode and a confidence. Trips below 0.85 are saved as `needs_review`.
3. **Duplicate prevention.** (a) a deterministic `dedupe_key` from the start sample (unique index locally and per user on the server); (b) time-overlap ≥ 60% with similar distance against nearby trips (also catches manual entries); (c) a serialised pipeline, so overlapping task invocations cannot interleave; (d) idempotent server upserts keyed by client UUID.
4. **Calculation.** A snapshot from `calc.ts` is stored on the trip.
5. **Persist and sync.** Saved locally as `pending`. The sync engine pushes it via `sync_push_trips`, then pulls changes since the cursor.

## Synchronisation and conflicts

* **Push:** the `sync_push_trips(jsonb)` RPC (SECURITY INVOKER, so RLS applies) upserts by UUID. **Last-write-wins on the client `updated_at`.** Deletions become content-free `trip_tombstones`, and a tombstone beats any older edit. A row skipped because of a duplicate `dedupe_key` does not fail the batch. Retrying the same payload is idempotent.
* **Pull:** rows with `server_updated_at` greater than the cursor (minus a 60-second overlap). A pulled row never overwrites a newer local pending edit. A local trip is marked `synced` only if it was not edited again after being pushed.
* **Failure handling:** errors keep data pending. Retries use exponential backoff (5 s up to 10 min) and also run on app foreground, after each change and (web) on the browser's `online` event. Imported records enter the same queue.
* **Known edge case:** if two phones of the same user detect the same journey, the server keeps the first. The second phone keeps its local copy until the user dismisses it.

## Agent

```
user question ─► mobility-assistant Edge Function ─► CORS/preflight ─► authenticate (JWT) ─► validate messages
             ─► rate limit (agent_runs, RLS)
             ─► runAgent(): LLM ⇄ tools (≤ 8 steps, 100 s deadline, 15 s per tool, 45 s per LLM request)
                 tool call ─► JSON-schema validation ─► tool.run(ctx.data = RLS-scoped port)
                           ─► structured result labelled recorded / estimate / simulated
             ─► reply + tool names ─► agent_runs metadata (no prompt, no reply, no location)
```

* **Ten tools:** `get_trip_history`, `get_emissions_summary`, `get_emission_factors`, `calculate_trip_emissions`, `compare_periods`, `get_route_options`, `compare_transport_modes`, `simulate_mobility_scenario`, `generate_sustainability_insight`, `get_user_preferences`.
* **No tool accepts a user ID, table name or SQL.** Each schema sets `additionalProperties: false`. Authorization comes from the caller's JWT plus RLS, not from tool arguments.
* **Privacy:** tools return place labels only, never coordinates. Ranges are capped at 400 days and 100 trips per call.
* **Prompt:** a stable system prompt (cached) with grounding rules. Volatile context (local time, routing availability) is appended to the latest user turn.
* **Gemini (default):** `gemini-3.8-flash` with `gemini-2.5-flash` as a fallback that is used only before the first model turn, because thought signatures are model-specific. Tool schemas are converted to Gemini's `Schema` subset (`additionalProperties` and `pattern` are dropped there, but full validation still happens server-side). Model `content` is echoed back verbatim, which preserves `thoughtSignature` parts, and tool results go back as `functionResponse` parts in a single user turn. A transient 5xx is retried once; HTTP errors are classified (429 per-day → `quota`, per-minute → `rate_limited`, invalid key → `auth`, abort → `timeout`). `MALFORMED_FUNCTION_CALL` is retried once. Tool calls in `MAX_TOKENS` responses are never executed. The API key is sent only in the `x-goog-api-key` header.
* **Anthropic (alternative, `LLM_PROVIDER=anthropic`):** `claude-opus-5-5`, effort `medium`, server-side refusal fallbacks, append-only conversation.
* **Failure modes:** invalid arguments and tool errors return to the model as error results with safe messages. A provider failure yields `status: llm_error` with an `errorKind` and a helpful fallback message. Refusals, safety blocks, max-steps and deadlines are handled explicitly.
* **Avoiding unnecessary LLM calls:** dashboards, insights, goals and scenarios are computed on the device without the LLM.

## Security summary

* RLS on `profiles`, `trips`, `trip_tombstones`, `goals` and `agent_runs` (owner-only). Reference tables are read-only. Explicit grants; `anon` cannot read user tables.
* `auth.users` deletion cascades to all user rows. `delete-account` uses the service role only for the verified caller's own ID.
* Session storage: Keychain/Keystore via chunked SecureStore on native; `localStorage` on the web (removed on sign-out, never in the service-worker cache). HTTPS only (the Supabase URL must be `https://`). Edge Functions answer browser preflights and can be restricted to `ALLOWED_ORIGINS`.
* Sign-out is refused while local changes have not been uploaded, because sign-out wipes the local copy.
* Server-side input validation: table CHECK constraints (distance, occupancy, label lengths, time order, max duration, calculation consistency), RPC batch limit (500), request body size limits, message count limits.
* No continuous location traces leave the device. Coordinates are rounded to about 110 m by default.

These properties are covered by tests (see TESTING.md). A professional security review is still recommended before a public release (see RELEASE_CHECKLIST.md).
