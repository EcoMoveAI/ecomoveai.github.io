# EcoMove AI — personal mobility carbon tracker (PWA)

EcoMove AI helps you understand, monitor and reduce the carbon emissions of your everyday travel. It estimates each trip's footprint with a **transparent, reproducible methodology**, compares reporting periods correctly, and offers a **tool-using AI assistant** whose answers come from your own data.

It runs as a **responsive, installable Progressive Web App** in desktop, tablet and mobile browsers. The same codebase still builds the Android/iOS app, which adds automatic GPS trip detection.

Built with React 19 + TypeScript · Expo Router + react-native-web (single-page export) · Workbox service worker · Cloudflare Pages · Supabase (Auth, Postgres + RLS, Edge Functions) · Google Gemini API (via an Edge Function; provider is replaceable).

| | |
|---|---|
| **Deploy: Cloudflare Pages, Supabase, Gemini** | [docs/DEPLOY_WEB.md](docs/DEPLOY_WEB.md) |
| **Migration report (native → PWA)** | [docs/MIGRATION_REPORT.md](docs/MIGRATION_REPORT.md) |
| Methodology and emission-factor sources | [docs/METHODOLOGY.md](docs/METHODOLOGY.md) |
| Architecture, sync, agent design | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Privacy and data flow | [docs/PRIVACY.md](docs/PRIVACY.md) |
| Tests and manual test plans | [docs/TESTING.md](docs/TESTING.md) |
| Feature status, missing integrations, limitations | [docs/STATUS.md](docs/STATUS.md) |
| Native Android/iOS builds (optional) | [docs/BUILD.md](docs/BUILD.md) |
| Release checklist | [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) |

## What it does

* **Manual trip entry**: choose the mode, enter the distance, and set the date, time and duration. A **live emission preview** shows the formula, factor, accounting boundary and source before you save. You can edit, delete, correct the mode, and confirm uncertain trips.
* **Deterministic carbon engine** with versioned, sourced factors: official Taiwanese carbon-label values for MRT, TRA and THSR, and UK DESNZ 2025 factors, labelled as proxies where they stand in for Taiwan. Every trip stores the exact factor and version used, so past reports stay reproducible.
* **Dashboards** by day, week, month and year: mode breakdown, trends, comparisons over the same elapsed part of each period, data-coverage notes, and insights phrased as associations, not causes.
* **AI assistant** (Gemini via the `mobility-assistant` Edge Function) with 10 validated tools: trip history, summaries, factors, calculator, period comparison, routes, mode comparison, scenario simulation, insights and preferences.
* **Goals, what-if scenarios, optional notifications, export (JSON/CSV), import from the mobile app**, and deletion of trips, all data, or the whole account.
* **Works offline.** The app shell is cached by a service worker, and trips are stored in the browser (IndexedDB). With an account, changes are queued and synced when you are back online.
* **Two ways to use it.** *Without an account*: everything except the assistant works, and data stays in your browser. *With an account*: backup, sync across devices, and the assistant.

> **The website never tracks your location.** Browsers cannot record trips in the background, so the PWA relies on manual entry. Automatic detection exists only in the native app. See [MIGRATION_REPORT.md §3](docs/MIGRATION_REPORT.md#removed-or-unavailable-on-the-web-still-in-the-native-build).

## Repository layout

```
src/app/                     Expo Router screens = website routes (/, /trips, /insights, /assistant, /profile, /trip/:id …)
src/{db,sync,services,state,ui,tracking}/   app modules; *.web.ts(x) files are the browser implementations
public/                      PWA manifest, icons, index.html template, Cloudflare _headers
supabase/functions/_shared/core/            shared domain logic (calc, factors, analytics, agent tools…)
supabase/functions/_shared/llm/             LLM providers (gemini.ts default, anthropic.ts) behind one interface
supabase/functions/{mobility-assistant,routes,delete-account}/   Edge Functions (Deno)
supabase/migrations/         schema, RLS, RPCs, generated factor seed
scripts/                     build-web (export + service worker + checks), preview server, PWA smoke test, icon/seed generators
__tests__/                   Jest (unit, integration, UI, web) and PGlite database tests
docs/                        deployment, migration report, methodology, architecture, privacy, testing, status
```

## Quick start (local, free, no accounts needed)

Requires Node.js 22 or 24 LTS and npm.

```bash
npm install
```

```bash
npm run web
```

This opens http://localhost:8081 with hot reload. To try the production PWA (offline use and install) locally:

```bash
npm run build:web
```

```bash
npm run preview:web
```

Then open http://localhost:4173.

## Configure accounts and the AI assistant

All three services have free tiers. Full step-by-step instructions are in **[docs/DEPLOY_WEB.md](docs/DEPLOY_WEB.md)**.

1. **Supabase:** run `npx supabase link`, then `npx supabase db push`. Set the Auth Site URL and redirect URLs to your site.
2. **Gemini:** put `GEMINI_API_KEY` in `supabase/.env` and run `npx supabase secrets set --env-file supabase/.env`. Then deploy the functions: `mobility-assistant`, `routes`, `delete-account`.
3. **Website:** set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (copy `.env.example` to `.env`, or set them in Cloudflare Pages). The Cloudflare build command is `npm run build:web` and the output directory is `dist`.

### Configuration reference

| Variable | Where | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `.env` / Cloudflare Pages (public) | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `.env` / Cloudflare Pages (public) | Publishable key. Safe to expose; access is limited by RLS |
| `GEMINI_API_KEY` | **Supabase function secret only** | AI assistant |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | Supabase secret | Defaults: `gemini-3.8-flash`, then `gemini-2.5-flash` |
| `LLM_PROVIDER` | Supabase secret | `gemini` (default) or `anthropic` (needs `ANTHROPIC_API_KEY`) |
| `GOOGLE_MAPS_API_KEY` | Supabase secret (optional, not used in the free setup) | Lets the assistant's `get_route_options` tool fetch real routes (Google Routes API needs a billing account). Without it the tool honestly reports routing as unavailable |
| `AGENT_HOURLY_LIMIT` | Supabase secret | Assistant requests per user per hour (default 30) |
| `ALLOWED_ORIGINS` | Supabase secret (recommended) | Browser origins allowed to call the functions |

> `EXPO_PUBLIC_*` values are bundled into the website and visible to anyone, just like `VITE_*` variables in Vite projects. **Never** put the Gemini key, the Maps key or the Supabase service-role key in them. The build fails if a secret-looking value appears in the output.

Without these keys the site still works. The assistant explains that it is unavailable, distances are entered by hand, and **nothing is invented** in place of a missing integration.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run test:pwa
```

On 2026-10-11 these produced: **143 Jest tests and 16 PostgreSQL/RLS tests passed**, typecheck and lint clean, the production web build verified, and **11/11 end-to-end PWA checks** in headless Edge. `test:pwa` covers the manifest, service worker, IndexedDB persistence and offline deep links. The AI and Maps providers are tested against mocked HTTP; no live calls were made. Details are in [docs/TESTING.md](docs/TESTING.md).

## Native app (optional)

Expo Go and EAS builds still work from the same code (`npx expo start`, see [docs/BUILD.md](docs/BUILD.md)). They add automatic trip detection with background location. The native app can export trips as JSON, which the website imports.

## Status

Functionally complete and tested as a PWA, but **not production-ready**. It still needs deployment with your own Supabase, Gemini and Cloudflare accounts, a live Gemini check, testing on real phones (install and offline), and the MOENV verification of the Taiwan road factors. See [docs/STATUS.md](docs/STATUS.md).

## Troubleshooting

| Problem | Solution |
|---|---|
| "Accounts are not configured in this build" | Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` **before** building, then rebuild or redeploy |
| Email confirmation link opens an error page | Add your site to Supabase Auth → URL Configuration (Site URL and redirect URLs) |
| Assistant: "not configured (GEMINI_API_KEY)" | Set the secret and redeploy `mobility-assistant` |
| Assistant: "usage quota is used up" | Gemini free-tier limit reached; wait, or set `GEMINI_FALLBACK_MODELS` |
| Assistant: network/CORS error in the browser console | Add the site's origin to `ALLOWED_ORIGINS` and run `supabase secrets set` again |
| Old version still shown after deploying | Accept "A new version is available", or close all EcoMove tabs and reopen |
| Data disappeared (no account) | Browser site data was cleared. Without an account, data lives only in that browser; use an account or export regularly |
| Sync shows changes waiting | Check your connection; changes are kept and retried automatically, or use Profile → Sync now |
| Wrong day for late-night trips | Check Profile → Preferences → time zone |

## Licence

No licence file is included yet. Choose one that suits your course or organisation before publishing the code.
