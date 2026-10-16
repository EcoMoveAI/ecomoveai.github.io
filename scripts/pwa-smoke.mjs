// End-to-end PWA smoke test against the production build, in headless Chromium/Edge via the DevTools
// protocol (no extra dependencies; Node ≥ 22 for the global WebSocket).
//   1. npm run build:web   2. npm run preview:web   3. node scripts/pwa-smoke.mjs [--browser <path>]
// Checks: manifest is served and parsed by the browser, the service worker installs and precaches only
// same-origin static files, a trip saved in the app survives a reload (IndexedDB), and the app — including
// a deep link — still loads with the network switched off.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.PWA_URL ?? `http://localhost:4173${(process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')}`;
const argBrowser = process.argv.indexOf('--browser');
const candidates = [
  argBrowser > 0 ? process.argv[argBrowser + 1] : null,
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const browserPath = candidates.find((p) => existsSync(p));
if (!browserPath) throw new Error('No Chromium-based browser found; pass --browser <path>.');

const profile = mkdtempSync(join(tmpdir(), 'ecomove-pwa-'));
const port = 9333;
const proc = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let seq = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

try {
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Network.enable');
  const evaluate = async (expression, timeout = 20000) => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const go = async (url) => {
    await s('Page.navigate', { url });
    await sleep(2500);
  };
  const waitFor = async (expr, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(expr).catch(() => false)) return true;
      await sleep(300);
    }
    return false;
  };

  // ---------------------------------------------------------------- manifest + SW
  await go(`${BASE}/`);
  const manifest = await s('Page.getAppManifest').catch(() => null);
  check('browser parses the web app manifest', !!manifest && !manifest.errors?.length && /EcoMove/.test(manifest.data ?? ''), manifest?.errors?.map((e) => e.message).join('; '));
  const installErrors = await s('Page.getInstallabilityErrors').catch(() => ({ installabilityErrors: [{ errorId: 'unsupported' }] }));
  const errs = installErrors.installabilityErrors.map((e) => e.errorId);
  check('no installability errors reported by the browser', errs.length === 0, errs.join(', '));

  const swOk = await waitFor('navigator.serviceWorker.ready.then(r => !!r.active)', 20000);
  check('service worker installs and activates', swOk);
  const cached = await evaluate(`(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) out.push(r.url); } return out; })()`);
  const paths = cached.map((u) => new URL(u).pathname);
  check('precache contains the app shell, bundle and sql.js WASM', paths.some((p) => p.endsWith('/index.html')) && paths.some((p) => p.includes('/_expo/static/js/')) && paths.some((p) => p.endsWith('/vendor/sqljs/sql-wasm.wasm')), `${cached.length} entries`);
  check('precache contains only same-origin static files', cached.every((u) => u.startsWith(BASE) && /\.(html|js|css|wasm|png|ico|ttf|json|webmanifest)(\?|$)/.test(u)));

  // ---------------------------------------------------------------- onboarding + a manual trip (IndexedDB)
  // Buttons are found by accessible name (icon glyphs are part of innerText, so the label is used instead).
  const clickText = (text) => evaluate(`(() => { const el = [...document.querySelectorAll('[role=button],button')].find(e => e.getAttribute('aria-label') === ${JSON.stringify(text)} || e.innerText.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
  if (await waitFor(`document.body.innerText.includes('Get started')`, 15000)) {
    await clickText('Get started');
    await waitFor(`!!document.querySelector('[aria-label="I have read the privacy summary"]')`);
    await evaluate(`document.querySelector('[aria-label="I have read the privacy summary"]').click()`);
    await sleep(300);
    await clickText('Continue');
    await waitFor(`document.body.innerText.includes('Use in this browser')`);
    await clickText('Use in this browser');
  }
  check('onboarding completes into the dashboard', await waitFor(`document.body.innerText.includes("TODAY'S MOBILITY FOOTPRINT")`));
  await go(`${BASE}/trip/new`);
  await waitFor(`!!document.querySelector('[aria-label="Bus"]')`);
  await evaluate(`document.querySelector('[aria-label="Bus"]').click()`);
  await evaluate(`(() => { const i = document.querySelector('input[aria-label="Distance (km)"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '7.5'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(`document.body.innerText.includes('EMISSIONS PREVIEW')`);
  await clickText('Save trip');
  const saved = await waitFor(`document.body.innerText.includes('How this was calculated')`);
  if (!saved && process.env.DEBUG) console.log(await evaluate('location.href + "\\n" + document.body.innerText.slice(0, 1500)'));
  check('manual trip is saved with a calculation trace', saved);
  const tripUrl = await evaluate('location.href');

  await go(`${BASE}/trips`);
  check('saved trip persists after a full reload (IndexedDB)', await waitFor(`document.body.innerText.includes('Bus')`));

  // ---------------------------------------------------------------- offline
  await s('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await go(`${BASE}/`);
  check('app shell loads offline', await waitFor(`document.body.innerText.includes("TODAY'S MOBILITY FOOTPRINT")`));
  await go(tripUrl);
  check('deep link loads offline (navigation fallback) with local data', await waitFor(`document.body.innerText.includes('How this was calculated')`));
  await go(`${BASE}/trip/new`);
  check('manual entry form is available offline', await waitFor(`!!document.querySelector('input[aria-label="Distance (km)"]')`));
  await s('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
} catch (e) {
  check(`smoke test crashed: ${e instanceof Error ? e.message : String(e)}`, false);
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  proc.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* the browser may still hold files briefly */
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PWA checks passed.`);
process.exit(failed ? 1 : 0);
