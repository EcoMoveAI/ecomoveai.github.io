// Production build of the EcoMove PWA (output: dist/).
//   1. copy sql.js into public/vendor
//   2. `expo export --platform web` (single-page app; public/ is copied to dist/)
//   3. --target github-pages only: GitHub Pages cannot send custom headers or rewrite routes, so the CSP from
//      public/_headers is added as a <meta> tag, index.html is copied to 404.html (SPA fallback) and
//      .nojekyll is written (otherwise Jekyll drops the `_expo/` folder)
//   4. generate the Workbox service worker (dist/sw.js) that precaches the app shell and static assets
//   5. verify the output (manifest, icons, routing fallback for the target, no leaked secrets)
// Targets: `cloudflare` (default; uses dist/_headers and SPA fallback without 404.html) or `github-pages`.
import { Buffer } from 'node:buffer';
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSW } from 'workbox-build';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env });

const skipExport = process.argv.includes('--skip-export');
const targetArg = process.argv.find((a) => a.startsWith('--target='));
const target = targetArg ? targetArg.slice('--target='.length) : process.env.WEB_TARGET ?? 'cloudflare';
if (!['cloudflare', 'github-pages'].includes(target)) throw new Error(`Unknown --target ${target}`);
console.log(`Web build target: ${target}`);

if (!skipExport) {
  run('node scripts/copy-web-vendor.mjs');
  run('npx expo export --platform web --output-dir dist --clear');
}

// Optional sub-path (e.g. "/ecomove" for https://<user>.github.io/ecomove/). Expo applies it to routes and
// bundles via app.config.js; the hand-written template and manifest are rewritten here.
const base = (process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
if (base && !/^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(base)) throw new Error(`Invalid EXPO_PUBLIC_BASE_URL "${base}"`);
if (base) {
  console.log(`Base path: ${base}`);
  const indexPath = join(dist, 'index.html');
  const escaped = base.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rewritten = readFileSync(indexPath, 'utf8').replace(new RegExp(`(href|src)="/(?!/|${escaped}/)`, 'g'), `$1="${base}/`);
  writeFileSync(indexPath, rewritten);
  const manifestPath = join(dist, 'manifest.webmanifest');
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const p = (u) => (u.startsWith('/') ? `${base}${u}` : u);
  m.id = `${base}/`;
  m.start_url = `${base}/`;
  m.scope = `${base}/`;
  m.icons = m.icons.map((i) => ({ ...i, src: p(i.src) }));
  m.shortcuts = (m.shortcuts ?? []).map((s) => ({ ...s, url: p(s.url), icons: (s.icons ?? []).map((i) => ({ ...i, src: p(i.src) })) }));
  writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
}

if (target === 'github-pages') {
  // Same policy as public/_headers; `frame-ancestors` is not allowed in a <meta> CSP and is dropped.
  const headerLine = readFileSync(join(root, 'public', '_headers'), 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('Content-Security-Policy:'));
  if (!headerLine) throw new Error('No Content-Security-Policy line found in public/_headers');
  const csp = headerLine.trim().slice('Content-Security-Policy:'.length).trim().split(';').map((d) => d.trim()).filter((d) => d && !d.startsWith('frame-ancestors')).join('; ');
  const indexPath = join(dist, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  if (!html.includes('http-equiv="Content-Security-Policy"')) {
    writeFileSync(indexPath, html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`));
  }
  copyFileSync(indexPath, join(dist, '404.html'));
  writeFileSync(join(dist, '.nojekyll'), '');
}

const { count, size, warnings } = await generateSW({
  globDirectory: dist,
  swDest: join(dist, 'sw.js'),
  // App shell + static assets only. Nothing user-specific is ever cached by the service worker:
  // Supabase/Gemini/API requests are cross-origin and fall through to the network untouched.
  globPatterns: ['**/*.{html,js,css,wasm,png,ico,svg,ttf,woff,woff2,json,webmanifest}'],
  globIgnores: ['sw.js', 'workbox-*.js', '_headers', '_redirects', '404.html', '**/*.map'],
  maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
  navigateFallback: `${base}/index.html`,
  navigateFallbackDenylist: [new RegExp(`^${base}/_expo/`), new RegExp(`^${base}/vendor/`), /\.[a-z0-9]+$/i],
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  // The app shows "A new version is available" and activates the update on request (SKIP_WAITING message).
  skipWaiting: false,
  sourcemap: false,
  // Hashed bundle names make the content hash in the URL sufficient for these.
  dontCacheBustURLsMatching: /\/_expo\/static\//,
});
warnings.forEach((w) => console.warn('workbox:', w));
console.log(`Service worker: precaching ${count} files (${(size / 1024 / 1024).toFixed(2)} MB)`);

// ---------------------------------------------------------------- verification
const problems = [];
const must = ['index.html', 'manifest.webmanifest', 'sw.js', '_headers', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'vendor/sqljs/sql-wasm.wasm'];
for (const f of must) if (!existsSync(join(dist, f))) problems.push(`missing dist/${f}`);
if (target === 'cloudflare' && existsSync(join(dist, '404.html'))) problems.push('dist/404.html exists: Cloudflare would not use SPA fallback routing');
if (target === 'github-pages') {
  for (const f of ['404.html', '.nojekyll']) if (!existsSync(join(dist, f))) problems.push(`missing dist/${f} (needed on GitHub Pages)`);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (!html.includes('rel="manifest"')) problems.push('index.html does not link the manifest');
if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html)) problems.push('index.html contains an inline script (blocked by the Content-Security-Policy)');
if (target === 'github-pages' && !html.includes('http-equiv="Content-Security-Policy"')) problems.push('index.html is missing the CSP <meta> tag');

// Secrets must never reach the bundle. Only EXPO_PUBLIC_* values are inlined by Expo.
const secretPatterns = [
  [/AIza[0-9A-Za-z_-]{35}/, 'a Google API key (Gemini/Maps)'],
  [/sk-ant-[0-9A-Za-z_-]{10,}/, 'an Anthropic API key'],
  [/sb_secret_[0-9A-Za-z_-]{10,}/, 'a Supabase secret key'],
  [/"role"\s*:\s*"service_role"/, 'a Supabase service-role JWT payload'],
];
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
for (const file of walk(dist).filter((f) => /\.(js|html|json|webmanifest)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  for (const [re, what] of secretPatterns) if (re.test(text)) problems.push(`${relative(dist, file)} contains ${what}`);
  // service_role JWTs are base64; check decoded JWT-looking tokens too.
  for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
    try {
      if (JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role === 'service_role') problems.push(`${relative(dist, file)} contains a service-role JWT`);
    } catch {
      /* not a JWT */
    }
  }
}

if (problems.length) {
  console.error('\nWeb build verification FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`Web build verified: dist/ is ready for ${target === 'github-pages' ? 'GitHub Pages' : 'Cloudflare'}.`);
