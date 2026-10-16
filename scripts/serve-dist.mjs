// Minimal static server for testing the production build locally, with the same SPA fallback and
// headers as Cloudflare Pages (reads dist/_headers). Usage: npm run preview:web  → http://localhost:4173
// Service workers only run on localhost or HTTPS, so this is enough to test install/offline behaviour.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT ?? 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// Parse Cloudflare's _headers format (path pattern line followed by indented "Name: value" lines).
const rules = [];
if (existsSync(join(dist, '_headers'))) {
  let current = null;
  for (const line of readFileSync(join(dist, '_headers'), 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push((current = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), headers: {} }));
    else if (current) {
      const i = line.indexOf(':');
      current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
}

// Serve under the same sub-path as the build (EXPO_PUBLIC_BASE_URL, e.g. "/ecomove" for GitHub Pages).
const base = (process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return res.writeHead(302, { Location: `${base}/` }).end();
  let path = normalize(decodeURIComponent(url.pathname.slice(base.length))).replace(/^([/\\])+/, '');
  let file = join(dist, path);
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // SPA fallback for routes without a file extension (Cloudflare Pages does the same without a 404.html).
    if (extname(path)) return res.writeHead(404).end('Not found');
    file = join(dist, 'index.html');
    path = 'index.html';
  }
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
  for (const r of rules) if (r.re.test('/' + path.replace(/\\/g, '/'))) Object.assign(headers, r.headers);
  delete headers['Strict-Transport-Security']; // not meaningful on http://localhost
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`EcoMove PWA preview: http://localhost:${port}${base}/`));
