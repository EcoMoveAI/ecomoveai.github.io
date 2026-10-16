// Copies the sql.js WebAssembly build into public/vendor so the web app can load it as a static,
// precacheable asset (see src/db/webDriver.ts). Run automatically by `npm run web` and `npm run build:web`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('sql.js/dist/sql-wasm.js'));
const out = join(root, 'public', 'vendor', 'sqljs');
mkdirSync(out, { recursive: true });
for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) copyFileSync(join(dist, f), join(out, f));
console.log(`sql.js copied to ${out}`);
