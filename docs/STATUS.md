# EcoMove AI — Implementation status, missing integrations and known limitations

*Status as of 2026-10-11 (v0.2.0, PWA migration). "Done" means implemented **and** covered by passing automated tests or the headless-browser PWA check, unless noted. No deployment to real Supabase, Gemini or Cloudflare accounts has been made from this environment.*

## Definition-of-done checklist (PWA migration)

| Requirement | Status | Evidence / note |
|---|---|---|
| Existing interface preserved | ✅ | Same screens, components, palette and navigation, rendered with react-native-web; side rail on wide screens |
| Website builds | ✅ | `npm run build:web` (export + service worker + secret/SPA checks) |
| Works in desktop and mobile browsers | ✅ (headless Edge + in-app Chromium at 375 px and 1280 px) | Real iOS Safari / Android Chrome devices not yet tested |
| Manifest and service worker valid | ✅ | Browser reports no installability errors; SW installs and precaches |
| Supabase authentication | ✅ code / ⚠ not run live | Email/password + email-confirmation redirect; needs your Supabase project |
| Create, edit, delete trips manually | ✅ | UI tests, browser smoke test |
| Trips persist | ✅ | IndexedDB persistence verified across reloads; cloud sync tested against server rules (PGlite + fake remote) |
| Deterministic emissions | ✅ | Unchanged engine and its unit tests (`__tests__/core`) |
| Dashboards from saved records | ✅ | No sample data in production views; empty states |
| Consistent period comparisons | ✅ | Elapsed-period truncation, time-zone tests |
| Users see only their own data | ✅ | RLS tests as two users in real Postgres (PGlite) |
| AI calls validated tools through the Edge Function | ✅ code / ⚠ not run live | Gemini provider tested with mocked HTTP; tool validation and authorization tested |
| Gemini key never in the frontend | ✅ | Build-time secret scan, config test, key sent only in a server-side header |
| Grounded AI responses | ✅ | System prompt rules + tools label recorded/estimate/simulated values; the LLM never calculates |
| Useful without AI | ✅ | Errors classified (quota/rate/auth/timeout) with fallback text pointing to Insights/Scenarios |
| Privacy, export, deletion | ✅ | Export JSON/CSV, import, delete trip/all/account; privacy notice updated for web and Gemini |
| Tests preserved | ✅ | 112 original Jest tests kept (3 adapted), 16 DB tests; +31 new |
| Deployment instructions | ✅ | [DEPLOY_WEB.md](DEPLOY_WEB.md) |
| Missing integrations disclosed | ✅ | This file |

## Feature status

### Available in the PWA
- [x] Manual trip entry with live emission preview, validation, editing, deletion, mode correction and confirmation of uncertain (imported) trips
- [x] Manual, detected and imported trips are distinguishable (filters: Manual / Auto; "Detected: entered manually / automatically" on each trip; sync badges)
- [x] Distances are entered manually (the "Estimate distance from route" button was removed on 2026-10-11 because Google's Routes API requires a billing account)
- [x] Day / week / month / year dashboards, comparisons, mode breakdown, trends, data-completeness notes, insights
- [x] Goals, what-if scenarios, mode comparison (all deterministic, on the device)
- [x] AI assistant (Gemini) with 10 tools, rate limit, metadata-only logging, graceful fallback
- [x] Accounts (Supabase Auth), offline-first sync with queue, LWW, tombstones, retry, sync-on-reconnect
- [x] Without an account: full use except the assistant; data in IndexedDB
- [x] Export JSON/CSV, import JSON (migration from the native app), delete trip / all / account, retention setting
- [x] Installable PWA, offline app shell, deep links offline, update prompt, install card
- [x] Optional browser notifications (permission flow; due reminders shown on next open; goal notifications)
- [x] Responsive layout (phone bottom tabs, desktop side rail, content max-width), dark mode

### Native-only (unchanged, not available on the web)
- [x] Automatic trip detection (foreground/background GPS) — **device validation still outstanding**
- [x] OS-scheduled local notifications

## Missing integrations and required credentials

| Integration | Status | What is needed |
|---|---|---|
| Supabase project | Code complete; migrations tested in PGlite; **not deployed** | `supabase link`, `db push`, Auth URL settings, `functions deploy` ([DEPLOY_WEB.md §2](DEPLOY_WEB.md#2-supabase-database-auth-functions)) |
| Gemini API | Code complete; mocked-HTTP tests only; **no live call made** | `GEMINI_API_KEY` as a Supabase secret; confirm the default model name is still offered on the free tier |
| Cloudflare Pages | Build verified locally; **not deployed** | Cloudflare account; Git integration or `wrangler pages deploy dist` ([DEPLOY_WEB.md §4](DEPLOY_WEB.md#4-cloudflare-pages-website)) |
| Google Maps Routes API | Removed from the trip form; only the assistant's route tool can use it, and it is not configured in the free deployment; mocked tests only | `GOOGLE_MAPS_API_KEY` (requires a Google Cloud billing account; monthly free credit) |
| Web Push (scheduled reminders while closed) | Not implemented | VAPID keys + a scheduled sender (e.g. Supabase cron + Edge Function); in-app summaries and on-open reminders are the alternative |
| Taiwan MOENV carbon-footprint database | **Blocked** (unchanged): host unreachable; API key needed | Verify car/motorcycle/bus/taxi values ([METHODOLOGY.md §5](METHODOLOGY.md)) |

## Known limitations

1. The website does not detect trips automatically; manual entry is the primary workflow (native app retains detection).
2. Without an account, data lives only in that browser profile; clearing site data deletes it. Browsers may evict storage under pressure (the app requests persistent storage; this is best-effort).
3. Two browser tabs editing at the same moment can overwrite each other's last write (each tab reloads after the other saves; one tab at a time is recommended).
4. Browser reminders appear only when EcoMove is opened after they are due.
5. Road-mode factors are UK proxies; the Taiwan-first set mixes accounting boundaries (disclosed in the app).
6. Gemini free-tier quotas and data-use terms apply; model names change — the default may need updating.
7. The AI conversation is not persisted (by design).
8. The UI is English-only.
9. Not production-ready: needs live deployment checks, real-device browser testing (iOS Safari/Android Chrome), an accessibility review with screen readers, a security review and a privacy-law review.

## Suggested next steps

1. Deploy Supabase + functions, set `GEMINI_API_KEY`, deploy to Cloudflare Pages, run the post-deploy smoke test ([DEPLOY_WEB.md §5](DEPLOY_WEB.md#5-after-deploying--smoke-test)).
2. Test install/offline on an iPhone (Safari → Add to Home Screen) and an Android phone (Chrome → Install).
3. Verify Taiwanese road-mode factors with MOENV and add them as new factor IDs (new set version).
4. Optional: Web Push for scheduled reminders; zh-TW localisation.
