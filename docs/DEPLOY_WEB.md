# Deploying the EcoMove PWA (Cloudflare Pages + Supabase + Gemini)

Three separate deployments, each done on its own. **Deploying the website does not deploy the Edge Functions or apply database migrations.**

| Part | Hosts | Deployed with | Holds secrets? |
|---|---|---|---|
| Website (static PWA) | Cloudflare Pages | `npm run build:web` → `dist/` | **No.** Only public `EXPO_PUBLIC_*` values |
| Database, auth, RLS | Supabase | `npx supabase db push` | — |
| Edge Functions (`mobility-assistant`, `routes`, `delete-account`) | Supabase | `npx supabase functions deploy …` | Yes: `GEMINI_API_KEY`, optional `GOOGLE_MAPS_API_KEY` |

Everything below uses free tiers. Limits are listed in [§6](#6-free-tier-notes).

---

## 0. Prerequisites

* Node.js **22 or 24 LTS** (`.nvmrc` pins 22 for Cloudflare; developed with 24.20) and npm 10+.
* A Cloudflare account (Pages), a Supabase account, and a Google account for a Gemini API key (Google AI Studio).
* Install dependencies once:

```bash
npm install
```

## 1. Run locally

Development server with hot reload (no service worker in development):

```bash
npm run web
```

This opens http://localhost:8081. With no `.env` file the site runs **without an account**: data stays in the browser, and the AI assistant is unavailable.

Production build plus a local preview with the same SPA fallback and headers as Cloudflare:

```bash
npm run build:web
```

```bash
npm run preview:web
```

This serves http://localhost:4173. Service workers run on `localhost`, so you can test installing the app and working offline here. The automated PWA check (needs Edge or Chrome installed) runs against this preview:

```bash
npm run test:pwa
```

## 2. Supabase (database, auth, functions)

1. Create a project at supabase.com. From **Project Settings → API**, note the **project URL**, the **publishable key** (`sb_publishable_…`, or the legacy anon key) and the **project ref**.
2. Link the project and apply the migrations (schema, RLS policies, sync RPCs, emission-factor seed):

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

3. **Auth URLs** (Dashboard → Authentication → URL Configuration). Without these, the email-confirmation link leads nowhere.
   * Site URL: `https://YOUR-PROJECT.pages.dev` (or your custom domain)
   * Redirect URLs: `https://YOUR-PROJECT.pages.dev/**`, `http://localhost:8081/**`, `http://localhost:4173/**`, plus `ecomoveai://**` if you also use the mobile app
   * Keep **Confirm email** on. For a small group of testers, you can also invite users from Authentication → Users.
4. **Server secrets.** Copy `supabase/.env.example` to `supabase/.env`, fill in `GEMINI_API_KEY` (see §3) and set `ALLOWED_ORIGINS=https://YOUR-PROJECT.pages.dev,http://localhost:8081,http://localhost:4173`. Then run:

```bash
npx supabase secrets set --env-file supabase/.env
```

5. Deploy the Edge Functions:

```bash
npx supabase functions deploy mobility-assistant
```

```bash
npx supabase functions deploy routes
```

```bash
npx supabase functions deploy delete-account
```

If you deployed the earlier mobile-only version, also remove its old assistant function. The app no longer calls it:

```bash
npx supabase functions delete agent
```

> **Existing data.** The database schema is unchanged from v0.1, so `db push` adds nothing new to a database already on v0.1, and existing accounts and trips are kept. Trips stored only on a phone (on-device mode) are migrated with **Export as JSON** in the mobile app, then **Profile → Import, export & delete → Import a JSON export** on the website. See [MIGRATION_REPORT.md](MIGRATION_REPORT.md).

## 3. Gemini API key (AI assistant)

1. Create a key at https://aistudio.google.com/apikey.
2. Put it **only** in `supabase/.env` as `GEMINI_API_KEY=…`, then re-run `npx supabase secrets set --env-file supabase/.env`. It must never go in `.env`, `EXPO_PUBLIC_*` variables or Cloudflare settings: anything in the website bundle is public.
3. Optional settings: `GEMINI_MODEL` (default `gemini-3.8-flash`) and `GEMINI_FALLBACK_MODELS` (default `gemini-2.5-flash`). A fallback model is tried when the main one is out of quota or unavailable at the start of a conversation. Model names and free-tier availability change, so check https://ai.google.dev/gemini-api/docs/pricing.
4. To switch providers without changing the app, set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`.

Without a key, the assistant screen explains that it is not configured. Everything else works, including Insights and Scenarios, which use the same deterministic tools.

## 4. Cloudflare Pages (website)

### Option A — Git integration (builds on Cloudflare)

1. Push this repository to GitHub or GitLab. Then in Cloudflare go to **Workers & Pages → Create → Pages → Connect to Git**.
2. Build settings:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm run build:web` |
| Build output directory | `dist` |
| Root directory | `/` (repository root) |
| Node.js version | Taken from `.nvmrc` (22); or set the variable `NODE_VERSION=22` |

3. Environment variables (Settings → Variables and secrets), for **both Production and Preview**:

| Variable | Value | Public? |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://YOUR_REF.supabase.co` | Yes, bundled into the site |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Yes, bundled into the site (protected by RLS) |

These are read **at build time**. Redeploy after changing them.

### Option B — Direct upload from your computer (used for the live deployment)

Put the two variables in a local `.env` file (copy `.env.example`), then build and upload in one step:

```bash
npm run deploy
```

This runs `npm run build:web` and then `wrangler deploy` with `wrangler.jsonc`. Cloudflare now creates new direct-upload Pages projects as **Workers static-assets** sites, served at `https://<name>.<account-subdomain>.workers.dev`. They are free and behave the same way: `dist/_headers` is applied, and `not_found_handling: "single-page-application"` in `wrangler.jsonc` provides the SPA fallback for deep links. Run `npx wrangler login` once first. On a brand-new account, the `workers.dev` HTTPS certificate can take a few minutes to become active after the first deploy.

Current deployment: `https://ecomove-ai.ecomove-ai.workers.dev` (Supabase project ref `ubromwvhtlxcmfwdsihn`, Tokyo).

### Option C — GitHub Pages (current live deployment)

The site is served from the repository `ecomove`, i.e. under a sub-path: `https://<github-user>.github.io/ecomove/`. On GitHub Pages the account name is always part of the address unless you add a custom domain.

The workflow sets `EXPO_PUBLIC_BASE_URL=/ecomove` (the repository name). `app.config.js` passes it to Expo Router as `experiments.baseUrl`; the app uses `BASE_PATH` (`src/config.ts`) for the service worker, sql.js, icons and the auth redirect; and `build-web.mjs` rewrites the links in `index.html` and the manifest's `id`/`start_url`/`scope`/icons. Cloudflare and local builds leave the variable unset and serve from the domain root.

To test locally under the sub-path, set `EXPO_PUBLIC_BASE_URL=/ecomove` in the terminal, then run `node scripts/build-web.mjs --target=github-pages`, `npm run preview:web` (served at `http://localhost:4173/ecomove/`) and `npm run test:pwa`.

`.github/workflows/deploy-pages.yml` runs on every push to `main`: typecheck, lint, Jest, `npm run build:web -- --target=github-pages`, then the Pages deployment.

* Repository **variables** (not secrets — the values are public): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
* Settings → Pages → Source: **GitHub Actions**.
* GitHub Pages cannot send custom headers or rewrite routes, so the `github-pages` target:
  * adds the CSP from `public/_headers` as a `<meta>` tag (`frame-ancestors` cannot be set this way, so framing protection is lost);
  * copies `index.html` to `404.html` so that deep links load the app (with HTTP status 404, which browsers ignore for display; offline, the service worker serves them normally);
  * writes `.nojekyll`, otherwise Jekyll would drop the `_expo/` folder.

  HSTS and `Permissions-Policy` headers are not available on GitHub Pages; HTTPS is still enforced by GitHub.
* The free plan requires the repository to be **public**. No secrets are committed: `.env` and `supabase/.env` are git-ignored, and the build fails if a secret-looking value reaches `dist/`.
* After a change of address: add the new origin to the Supabase Auth Site URL and redirect URLs and to `ALLOWED_ORIGINS`. Account data is unaffected, because it lives in Supabase. The browser's local copy is per-site, so sign in once on the new address and it downloads your trips; make sure the old site showed "All changes synced" first.

### What the build does

`scripts/build-web.mjs`:

1. Copies the sql.js WebAssembly engine into `public/vendor`.
2. Runs `expo export --platform web` as a single-page app.
3. Generates the Workbox service worker (`dist/sw.js`).
4. **Fails the build** if any of the following is true:
   * the manifest, icons or service worker is missing;
   * `index.html` contains an inline script (which the CSP would block);
   * a `404.html` exists (it would disable Cloudflare's SPA fallback);
   * anything resembling a Google, Anthropic or Supabase secret, or a service-role JWT, appears in the output.

### Routing and headers

* **Nested routes.** `dist/` has no `404.html`, so Cloudflare Pages serves `index.html` for unknown paths. Direct links and refreshes on routes such as `/trip/…` or `/insights` work, and the service worker does the same when offline. No `_redirects` file is needed.
* **Headers.** `public/_headers` (copied to `dist/`) sets the CSP, `Permissions-Policy: geolocation=()` (the website never uses location), `X-Frame-Options`, `nosniff`, HSTS, and the caching rules: `sw.js` and `index.html` are revalidated, while hashed bundles are cached as immutable.
* **CSP.** `connect-src` allows `https://*.supabase.co`. If you use a **custom Supabase domain**, add it to `connect-src` in `public/_headers` and rebuild.

### Custom domain (optional)

1. In Pages → Custom domains → Set up a domain, then follow the DNS steps. HTTPS is automatic.
2. Add the new origin to the Supabase Site URL and redirect URLs (§2.3) and to `ALLOWED_ORIGINS` (§2.4), then run `supabase secrets set` again.

## 5. After deploying — smoke test

1. Open the site, choose **With an account**, sign up, and confirm the email. The link should return to `/auth` and sign you in.
2. Add a trip and check that Home and Insights update. Profile should show "All changes synced".
3. Ask the assistant: *"Why was my carbon footprint higher this month?"* The answer should list the tools it used. If it says the quota is exhausted, see §6.
4. Install the site: browser menu → Install app, or on iOS Safari Share → Add to Home Screen. Then turn on airplane mode, reopen it, add a trip, go back online, and check that it syncs.
5. Check the Edge Function logs (Dashboard → Edge Functions → Logs). They contain only error names, never prompts.

## 6. Free-tier notes

| Service | Free tier (check the provider's current terms) | Effect on EcoMove |
|---|---|---|
| Cloudflare Pages | Static hosting with generous bandwidth; limited builds per month | No effect for a small group |
| Supabase | Small database and Edge Function quotas. **Free projects pause after about a week of inactivity**; the built-in email sender is heavily rate-limited | A paused project makes sign-in, sync and the assistant unavailable until you resume it in the dashboard. Without an account, everything keeps working in the browser |
| Gemini API | Requests per minute and per day are limited and change over time. **Content may be used by Google to improve its products and may be reviewed by humans** (paid tier: not used) | When the quota runs out, the app says so and points to Insights and Scenarios. Tell testers not to put sensitive personal details in questions |
| Google Maps Routes API | Needs a billing account (has a monthly free credit) | Optional. Without it, distances are entered by hand |

Nothing in this setup needs a paid plan or a credit card. The Google Maps route lookup, which would need a billing account, has been removed from the trip form.
