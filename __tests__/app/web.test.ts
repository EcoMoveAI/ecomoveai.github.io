/**
 * @jest-environment node
 *
 * Web/PWA-specific logic that runs without a browser: data import (migration from the mobile app),
 * browser reminder timing, the sql.js storage adapter, and the PWA manifest/headers/service-worker config.
 * Browser-only behaviour (IndexedDB, service worker, install prompt) is verified manually — see docs/TESTING.md.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Repository } from '@/db/repository';
import { buildExportJson } from '@/services/exportFormat';
import { parseImport, tripProblem } from '@/services/importData';
import { shouldDeliverReminder } from '@/services/reminders';
import { makeTrip } from '../helpers';
import { createSqlJsDriver } from './sqljsDriver';

const root = join(__dirname, '..', '..');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trip = (n: number, extra: Record<string, unknown> = {}) => ({ ...makeTrip('2026-10-01T01:00:00Z', 'bus', 5), id: uuid(n), ...extra });

describe('data import (mobile → web migration)', () => {
  const prefs = { timeZone: 'Asia/Taipei' } as never;

  it('round-trips an export and keeps the original calculation snapshot', () => {
    const t = trip(1, { syncStatus: 'synced' });
    const parsed = parseImport(buildExportJson({ trips: [t as never], goals: [], preferences: prefs }));
    expect(parsed.skipped).toBe(0);
    expect(parsed.trips).toHaveLength(1);
    expect(parsed.trips[0]).not.toHaveProperty('syncStatus');
    expect(parsed.trips[0].emissionsKg).toBe(t.emissionsKg);
    expect(parsed.trips[0].factorId).toBe(t.factorId);
    expect(parsed.trips[0].factorSetVersion).toBe(t.factorSetVersion);
  });

  it('rejects invalid trips with reasons and skips tombstones', () => {
    const doc = {
      format: 'ecomove-export-v1',
      trips: [trip(1), trip(2, { distanceKm: -1 }), trip(3, { mode: 'rocket' }), trip(4, { id: 'not-a-uuid' }), trip(5, { deletedAt: '2026-10-02T00:00:00Z' }), trip(6, { calcStatus: 'calculated', emissionsKg: null })],
      goals: [{ id: uuid(9), type: 'max_taxi_trips', targetValue: 4, period: 'month', status: 'active', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', deletedAt: null }],
    };
    const parsed = parseImport(JSON.stringify(doc));
    expect(parsed.trips.map((t) => t.id)).toEqual([uuid(1)]);
    expect(parsed.goals).toHaveLength(1);
    expect(parsed.skipped).toBe(4);
    expect(parsed.problems.join(' ')).toMatch(/invalid distance/);
    expect(parsed.problems.join(' ')).toMatch(/unknown transport mode/);
  });

  it('refuses files that are not EcoMove exports', () => {
    expect(() => parseImport('not json')).toThrow(/valid JSON/);
    expect(() => parseImport(JSON.stringify({ trips: [] }))).toThrow(/Not an EcoMove export/);
  });

  it('validates time order and duration', () => {
    expect(tripProblem(trip(1, { endedAt: '2026-09-30T00:00:00Z' }))).toMatch(/ends before/);
    expect(tripProblem(trip(1, { endedAt: '2026-10-03T02:00:00Z' }))).toMatch(/24 hours/);
  });
});

describe('browser reminders', () => {
  const at = (s: string) => new Date(s); // local time (no Z) — reminders follow the device clock
  it('daily summary is due from 21:00 and only once per day', () => {
    expect(shouldDeliverReminder('dailySummary', at('2026-10-11T20:59:00'), null)).toBe('2026-10-10');
    expect(shouldDeliverReminder('dailySummary', at('2026-10-11T21:00:00'), '2026-10-10')).toBe('2026-10-11');
    expect(shouldDeliverReminder('dailySummary', at('2026-10-11T23:00:00'), '2026-10-11')).toBeNull();
  });
  it('weekly insight is keyed to Monday 09:00; monthly report to the 1st 09:00', () => {
    expect(shouldDeliverReminder('weeklyInsight', at('2026-10-12T09:30:00'), null)).toBe('2026-10-12'); // Monday
    expect(shouldDeliverReminder('weeklyInsight', at('2026-10-12T08:00:00'), null)).toBe('2026-10-05');
    expect(shouldDeliverReminder('monthlyReport', at('2026-11-01T10:00:00'), '2026-10-01')).toBe('2026-11-01');
    expect(shouldDeliverReminder('monthlyReport', at('2026-11-01T08:00:00'), '2026-10-01')).toBeNull();
  });
});

describe('sql.js storage adapter (web database)', () => {
  it('persists after each write and once per transaction, and supports the full repository', async () => {
    let writes = 0;
    const repo = new Repository(await createSqlJsDriver(() => (writes += 1)));
    await repo.migrate();
    const before = writes;
    await repo.saveTrip(makeTrip('2026-10-01T01:00:00Z', 'metro', 8));
    expect(writes).toBe(before + 1);
    const w = writes;
    await repo.transactionally(async () => {
      await repo.saveTrip(makeTrip('2026-10-01T02:00:00Z', 'bus', 3));
      await repo.saveTrip(makeTrip('2026-10-01T03:00:00Z', 'walking', 1));
    });
    expect(writes).toBe(w + 1);
    expect(await repo.listTrips()).toHaveLength(3);
    expect(await repo.countPending()).toBe(3);
  });

  it('serialises overlapping transactions and rolls back failures', async () => {
    const repo = new Repository(await createSqlJsDriver());
    await repo.migrate();
    const a = repo.transactionally(async () => {
      await repo.saveTrip(makeTrip('2026-10-01T01:00:00Z', 'metro', 8));
      await new Promise((r) => setTimeout(r, 5));
    });
    const b = repo.transactionally(async () => {
      await repo.saveTrip(makeTrip('2026-10-01T02:00:00Z', 'bus', 3));
      throw new Error('boom');
    });
    await a;
    await expect(b).rejects.toThrow('boom');
    expect(await repo.listTrips()).toHaveLength(1);
  });
});

describe('PWA configuration', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'));

  it('has a valid, installable web app manifest', () => {
    expect(manifest.name).toBe('EcoMove AI');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9A-F]{6}$/i);
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of manifest.icons) expect(existsSync(join(root, 'public', i.src))).toBe(true);
  });

  it('index template links the manifest and has no inline scripts (CSP)', () => {
    const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="theme-color"');
    expect(html).not.toMatch(/<script/);
  });

  it('Cloudflare headers lock down the site and keep the service worker fresh', () => {
    const headers = readFileSync(join(root, 'public', '_headers'), 'utf8');
    expect(headers).toMatch(/Content-Security-Policy: default-src 'self'/);
    expect(headers).toMatch(/connect-src 'self' https:\/\/\*\.supabase\.co/);
    expect(headers).toMatch(/Permissions-Policy: geolocation=\(\)/); // the website never uses location
    expect(headers).toMatch(/\/sw\.js\s+Cache-Control: no-cache/);
    expect(existsSync(join(root, 'public', '404.html'))).toBe(false); // keeps Pages' SPA fallback
  });

  it('the service worker only precaches same-origin static assets (no API/data caching)', () => {
    const build = readFileSync(join(root, 'scripts', 'build-web.mjs'), 'utf8');
    expect(build).not.toMatch(/runtimeCaching/);
    expect(build).toMatch(/navigateFallback: `\$\{base\}\/index\.html`/);
  });

  it('frontend config only reads public EXPO_PUBLIC_ variables', () => {
    const files = ['src/config.ts', 'src/services/supabase.ts', 'src/services/api.ts'].map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
    const envVars = files.match(/process\.env\.([A-Z_]+)/g) ?? [];
    expect(envVars.length).toBeGreaterThan(0);
    for (const v of envVars) expect(v).toMatch(/process\.env\.EXPO_PUBLIC_/);
    expect(files).not.toMatch(/GEMINI_API_KEY|SERVICE_ROLE/);
  });
});
