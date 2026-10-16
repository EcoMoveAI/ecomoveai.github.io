# Release checklist

Use this before sharing the website (or a native build) with people outside the development team.

## Code and tests
- [ ] `npm test` passes (Jest + database tests)
- [ ] `npm run typecheck` and `npm run lint` pass
- [ ] `npm run build:web` passes its verification (no secrets, PWA files present, no `404.html`)
- [ ] `npm run preview:web` + `npm run test:pwa` pass (11/11)
- [ ] Live checks L1–L8 ([TESTING.md](TESTING.md)) run against the deployed site
- [ ] Native only: `npx expo-doctor`; device test plan D1–D12 on at least one Android and one iOS device

## Website (Cloudflare Pages)
- [ ] Build command `npm run build:web`, output `dist`, Node 22 (`.nvmrc`)
- [ ] `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set for Production **and** Preview; no other variables needed (and no secrets)
- [ ] Deep link refresh works (e.g. `/insights`, `/trip/<id>`); `_headers` applied (check the CSP response header)
- [ ] Custom domain (if any) added to Supabase Auth URLs, `ALLOWED_ORIGINS`, and CSP `connect-src` if the Supabase domain is custom
- [ ] Installed on an iPhone and an Android phone; offline reopen works

## Backend (Supabase)
- [ ] `npx supabase db push` applied all migrations
- [ ] Edge Functions deployed: `mobility-assistant`, `routes`, `delete-account` (`verify_jwt = true`); old `agent` function deleted if it existed
- [ ] Secrets set: `GEMINI_API_KEY` (or `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`), optional `GEMINI_MODEL`/`GEMINI_FALLBACK_MODELS`, `GOOGLE_MAPS_API_KEY`, `AGENT_HOURLY_LIMIT`, `ALLOWED_ORIGINS`
- [ ] Default Gemini model still available on your tier (https://ai.google.dev/gemini-api/docs/pricing)
- [ ] Google Maps key restricted to the Routes API; budget alerts configured
- [ ] Supabase Auth: Site URL + redirect URLs for the site, email confirmation on, password policy reviewed, leaked-password protection enabled if available; custom SMTP if more than a few sign-ups per hour are expected
- [ ] Supabase advisors (Security / Performance) report no RLS warnings
- [ ] Free-tier project pausing understood (resume after inactivity) or a paid plan chosen

## Privacy, security and compliance
- [ ] Privacy notice reviewed by someone qualified in Taiwan PDPA (and GDPR if EU users); compliance claims made only after that review
- [ ] Testers informed that the Gemini free tier may use assistant content to improve Google products; consider the paid tier for real users
- [ ] Data-processing terms accepted with Supabase, Google (Gemini/Maps) and Cloudflare
- [ ] Security review: RLS policies, Edge Function input validation, secrets handling, CSP, dependency audit (`npm audit`)
- [ ] Accessibility check with VoiceOver, TalkBack and a desktop screen reader; contrast in light and dark mode; browser zoom 200%

## Methodology
- [ ] Emission factors re-checked against sources; new DESNZ release or Taiwan label renewals reviewed (THSR label valid to 2027-12-16)
- [ ] Factor changes made as new factor IDs plus a set-version bump; seed regenerated (`npm run gen:factor-seed`)
- [ ] [METHODOLOGY.md](METHODOLOGY.md) and the in-app methodology screen match the shipped dataset

## Native store submission (only if publishing the native app)
- [ ] Final `ios.bundleIdentifier` and `android.package`; native app icon replaced (still the Expo template; the PWA uses the EcoMove leaf icons in `public/icons`)
- [ ] **Google Play:** Data safety form, location permissions declaration with video of the in-app disclosure, foreground-service declaration
- [ ] **Apple:** App Privacy label, location usage strings, review notes explaining background location
- [ ] Internal testing (Play internal track / TestFlight) completed before production
