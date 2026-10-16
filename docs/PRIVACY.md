# EcoMove AI — Privacy and Data Flow

*Privacy notice version 2026-10-11 (covers the website/PWA and the native app). The in-app notice under Profile → Privacy & data controls shows the same information in shorter form, adapted to the platform.*

> This document describes how the software handles data. It is **not** a statement of compliance with any privacy law (e.g. Taiwan PDPA, GDPR). Compliance has not been formally assessed and requires review by a qualified person before a public release.

## Data inventory

| Data | Where it is stored | Leaves the device? | Retention |
|---|---|---|---|
| Location | **Website: never collected** (`Permissions-Policy: geolocation=()`). Native app: raw GPS samples only inside the in-progress trip detector | Never | Native: deleted when the trip ends or tracking stops |
| Trip summary (times, distance, mode, emissions, factor snapshot) | Browser IndexedDB / phone SQLite; Supabase `trips` with an account | Only to your own Supabase account | Until you delete it, or per the retention setting (6/12/24 months) |
| Trip start/end coordinates | Only for trips detected by the native app (rounded to about 110 m by default), including those later imported into the website | Only to your account; never to the AI provider | Same as the trip |
| Place names you type | Browser/phone; Supabase with an account | To the AI provider as trip labels when you use the assistant (no mapping service is used) | Same as the trip |
| Preferences, goals | Browser/phone; Supabase with an account | Preferences go to the AI provider when relevant to a question | Until changed or deleted |
| Account email, password | Supabase Auth | Password handled only by Supabase Auth | Until account deletion |
| Session token | Website: browser `localStorage`. Native: iOS Keychain / Android Keystore | To Supabase over HTTPS | Until sign-out |
| AI questions and answers | Not stored by EcoMove (the conversation lives only in the open page) | Question and summarised tool results go to the AI provider | Subject to the AI provider's terms (see below) |
| AI run metadata (time, tools used, duration, token counts, model, status) | Supabase `agent_runs` | No | Until account deletion |
| App code, fonts and icons (offline cache) | Service-worker cache | No | Replaced on update |

**The service-worker cache never contains trips, sessions or API responses.** It holds only the site's own static files. Supabase and Gemini requests bypass it.

## Data flows

```
You type a trip ──► calculation in the browser ──► IndexedDB (this browser only)
                                                 └─(account)─► Supabase (HTTPS, RLS)
Assistant question ──► Supabase Edge Function "mobility-assistant" ──► tools read YOUR rows (RLS)
                     ──► Google Gemini API receives: question + structured results (labels, km, kg — no coordinates)
```

## AI provider: Google Gemini API

* The Gemini key is held only by the Edge Function and is never sent to the browser.
* Only what a question needs is sent: the question, recent conversation turns (up to 12 messages of 4,000 characters each), and **summarised tool results**. These are aggregates, trip lists with place labels, kilometres and kilograms, preferences and accessibility notes. Coordinates, GPS traces, emails and user IDs are never sent.
* **Free tier.** According to Google's pricing page, content submitted on the free tier *is used to improve Google's products*, and Google's terms say it may be reviewed by humans. On the paid tier it is not used that way. EcoMove's privacy notice states this, and testers should be told not to put sensitive personal details (health, exact home address, etc.) in assistant questions. Check Google's current Gemini API terms before inviting users: they are the authority, not this document.
* Prompts and answers are not logged by EcoMove. Function logs contain only error class names.

## Principles implemented

* **Explicit consent.** Onboarding requires acknowledging the privacy summary. On the website no location permission is ever requested. In the native app, tracking is a separate opt-in, and background permission is requested only after an in-app explanation.
* **Data minimisation.** No location on the web; place labels are optional; the AI receives aggregates and labels only.
* **No sale of data.** EcoMove itself does not use trip data to train models. Where Google may use free-tier assistant content, this is disclosed (see above).
* **User rights.** Delete a single trip, all trips and goals, or the whole account (server-side cascade). Export JSON/CSV. Import your own export. Retention setting.
* **Security.** RLS on every user table; secrets only server-side; HTTPS; strict CSP; per-origin CORS (configurable).
* **Shared computers.** Without an account, data stays in that browser profile. With an account, signing out removes the local copy (only after pending changes have been uploaded). The sign-in screen advises signing out on shared computers.
* **Notifications** are off by default and contain no locations or trip details.

## Third parties

| Service | Purpose | Data received | When |
|---|---|---|---|
| Cloudflare Pages | Hosts the website files | IP address and browser details of page requests (standard web hosting logs); no trip data | Every visit |
| Supabase | Auth, database, Edge Functions | Account and trip data | Account mode only |
| Google (Gemini API) | AI assistant | Question, summarised trip data, preferences | Only when the assistant is used |
| Browser / OS vendors | Notifications (if enabled); native location services | Per their policies | When those features are enabled |
| Expo / EAS | Native build service | Source code at build time (no user data) | Native builds only |
