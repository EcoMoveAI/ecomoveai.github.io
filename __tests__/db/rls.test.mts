/**
 * Database integration tests: runs the real Supabase migrations inside PGlite (Postgres compiled to WASM)
 * with stand-ins for Supabase's `auth` schema and roles, then checks Row Level Security, the sync RPC,
 * constraints and cascading account deletion.
 *
 * Run with: npm run test:db
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { calculateEmissions, toTripCalculation } from '../../supabase/functions/_shared/core/calc.ts';
import { getFactorSetOrDefault } from '../../supabase/functions/_shared/core/factors.ts';
import { buildFactorSeedSql } from '../../supabase/functions/_shared/core/factorSeed.ts';
import { tripToRow } from '../../supabase/functions/_shared/core/remote.ts';
import type { TransportMode, Trip } from '../../supabase/functions/_shared/core/types.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SET = getFactorSetOrDefault('ecomove-tw-hybrid');

let db: PGlite;

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`;

function trip(id: string, mode: TransportMode, km: number, updatedAt = '2026-10-10T01:00:00.000Z', extra: Partial<Trip> = {}): Trip {
  const calc = calculateEmissions({ distanceKm: km, mode }, SET);
  return {
    id, startedAt: '2026-10-10T00:00:00.000Z', endedAt: '2026-10-10T00:30:00.000Z', distanceKm: km, mode, proposedMode: null,
    variant: calc.factor?.variant ?? null, occupancy: null, origin: { label: 'Home' }, destination: { label: 'Campus' },
    detectionSource: 'manual', classificationConfidence: null, confirmationStatus: 'confirmed', dedupeKey: null, notes: null,
    createdAt: '2026-10-10T00:31:00.000Z', updatedAt, deletedAt: null, ...toTripCalculation(calc, new Date(updatedAt)), ...extra,
  };
}

/** Runs `fn` as the given Supabase role / user inside a transaction that is always rolled back on error. */
async function as<T>(role: 'anon' | 'authenticated', userId: string | null, fn: (tx: PGlite) => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`);
  try {
    return await fn(db);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

async function push(rows: unknown[]) {
  const r = await db.query<{ trip_id: string; applied: boolean }>('select * from public.sync_push_trips($1::jsonb)', [JSON.stringify(rows)]);
  return r.rows;
}

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');`);
});

after(async () => {
  await db?.close();
});

describe('migrations and reference data', () => {
  it('creates a profile for each new auth user', async () => {
    const r = await db.query<{ n: number }>('select count(*)::int as n from public.profiles');
    assert.equal(r.rows[0].n, 2);
  });

  it('the committed seed migration matches the TypeScript factor dataset (run npm run gen:factor-seed)', () => {
    const committed = readFileSync(new URL('../../supabase/migrations/20261010000100_seed_emission_factors.sql', import.meta.url), 'utf8');
    assert.equal(committed, buildFactorSeedSql());
  });

  it('seeds every emission factor and factor set from the TypeScript dataset', async () => {
    const f = await db.query<{ id: string; value: string }>("select id, value::text from public.emission_factors where id = 'twcfp-taipei-metro-2024-pkm'");
    assert.equal(Number(f.rows[0].value), 0.075);
    const s = await db.query<{ n: number }>('select count(*)::int as n from public.emission_factor_sets');
    assert.equal(s.rows[0].n, 2);
  });

  it('lets anonymous users read factors but not trips', async () => {
    await as('anon', null, async () => {
      const f = await db.query<{ n: number }>('select count(*)::int as n from public.emission_factors');
      assert.ok(f.rows[0].n > 10);
      await assert.rejects(db.query('select * from public.trips'), /permission denied/);
    });
  });

  it('prevents clients from modifying emission factors', async () => {
    await as('authenticated', A, async () => {
      await assert.rejects(db.query("update public.emission_factors set value = 0 where id = 'desnz25-car-average-unknown-vkm'"), /permission denied/);
      await assert.rejects(db.query("insert into public.emission_factors (id) values ('fake')"), /permission denied/);
    });
  });
});

describe('row level security on trips', () => {
  const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';

  it('lets a user create and read their own trip through the sync RPC', async () => {
    await as('authenticated', A, async () => {
      const res = await push([tripToRow(trip(T1, 'car', 10))]);
      assert.deepEqual(res, [{ trip_id: T1, applied: true }]);
      const r = await db.query<{ user_id: string; emissions_kg: number }>('select user_id, emissions_kg from public.trips');
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0].user_id, A);
      assert.ok(Math.abs(r.rows[0].emissions_kg - 1.6725) < 1e-9);
    });
  });

  it('hides the trip from another user and blocks reads, updates and deletes', async () => {
    await as('authenticated', B, async () => {
      assert.equal((await db.query('select * from public.trips')).rows.length, 0);
      assert.equal((await db.query(`update public.trips set distance_km = 1 where id = '${T1}'`)).affectedRows, 0);
      assert.equal((await db.query(`delete from public.trips where id = '${T1}'`)).affectedRows, 0);
    });
  });

  it('rejects inserting a row on behalf of another user', async () => {
    await as('authenticated', B, async () => {
      const row = { ...tripToRow(trip('bbbbbbbb-0000-4000-8000-000000000001', 'bus', 3)), user_id: A };
      delete (row as { deleted_at?: unknown }).deleted_at;
      const cols = Object.keys(row);
      await assert.rejects(
        db.query(`insert into public.trips (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row)),
        /row-level security/,
      );
    });
  });

  it('does not let another user overwrite a trip by reusing its id', async () => {
    await as('authenticated', B, async () => {
      await assert.rejects(push([tripToRow(trip(T1, 'walking', 1, '2027-01-01T00:00:00.000Z'))]), /row-level security/);
    });
    await as('authenticated', A, async () => {
      const r = await db.query<{ mode: string }>(`select mode from public.trips where id = '${T1}'`);
      assert.equal(r.rows[0].mode, 'car');
    });
  });

  it('applies last-write-wins on the client updated_at and is idempotent on retry', async () => {
    await as('authenticated', A, async () => {
      const stale = await push([tripToRow(trip(T1, 'bus', 10, '2026-10-10T00:59:00.000Z'))]);
      assert.equal(stale[0].applied, false);
      const newer = tripToRow(trip(T1, 'bus', 10, '2026-10-10T02:00:00.000Z'));
      assert.equal((await push([newer]))[0].applied, true);
      assert.equal((await push([newer]))[0].applied, true); // retry with identical payload
      const r = await db.query<{ mode: string; n: number }>('select mode, count(*) over ()::int as n from public.trips');
      assert.equal(r.rows[0].mode, 'bus');
      assert.equal(r.rows[0].n, 1);
    });
  });

  it('skips a duplicate automatic detection (same dedupe key) without failing the batch', async () => {
    await as('authenticated', A, async () => {
      const a = tripToRow(trip('aaaaaaaa-0000-4000-8000-000000000002', 'walking', 2, undefined, { detectionSource: 'auto', dedupeKey: 'auto:123' }));
      const b = tripToRow(trip('aaaaaaaa-0000-4000-8000-000000000003', 'walking', 2, undefined, { detectionSource: 'auto', dedupeKey: 'auto:123' }));
      const res = await push([a, b]);
      assert.deepEqual(res.map((x) => x.applied), [true, false]);
    });
  });

  it('enforces data constraints', async () => {
    await as('authenticated', A, async () => {
      const bad = { ...tripToRow(trip('aaaaaaaa-0000-4000-8000-000000000004', 'car', 5)), emissions_kg: null };
      await assert.rejects(push([bad]), /trips_calc_consistency/);
      const negative = { ...tripToRow(trip('aaaaaaaa-0000-4000-8000-000000000005', 'car', 5)), distance_km: -1 };
      await assert.rejects(push([negative]), /check constraint/);
      const backwards = { ...tripToRow(trip('aaaaaaaa-0000-4000-8000-000000000006', 'car', 5)), ended_at: '2026-10-09T00:00:00Z' };
      await assert.rejects(push([backwards]), /trips_time_order/);
    });
  });

  it('propagates deletions as content-free tombstones visible only to the owner', async () => {
    await as('authenticated', A, async () => {
      const del = { ...tripToRow(trip(T1, 'bus', 10, '2026-10-10T03:00:00.000Z')), deleted_at: '2026-10-10T03:00:00.000Z' };
      assert.equal((await push([del]))[0].applied, true);
      assert.equal((await db.query(`select * from public.trips where id = '${T1}'`)).rows.length, 0);
      const t = await db.query<Record<string, unknown>>('select * from public.trip_tombstones');
      assert.equal(t.rows.length, 1);
      assert.deepEqual(Object.keys(t.rows[0]).sort(), ['deleted_at', 'server_updated_at', 'trip_id', 'user_id']);
      // An older edit arriving after the deletion must not resurrect the trip.
      assert.equal((await push([tripToRow(trip(T1, 'bus', 10, '2026-10-10T02:30:00.000Z'))]))[0].applied, false);
    });
    await as('authenticated', B, async () => {
      assert.equal((await db.query('select * from public.trip_tombstones')).rows.length, 0);
    });
  });
});

describe('agent metadata, data deletion and account deletion', () => {
  it('keeps agent run metadata private and append-only', async () => {
    await as('authenticated', A, async () => {
      await db.query("insert into public.agent_runs (provider, model, status, steps) values ('anthropic', 'm', 'ok', 2)");
      await assert.rejects(db.query('delete from public.agent_runs'), /permission denied/);
    });
    await as('authenticated', B, async () => {
      assert.equal((await db.query('select * from public.agent_runs')).rows.length, 0);
    });
  });

  it('delete_my_data removes only the caller\'s data', async () => {
    await as('authenticated', B, async () => {
      await push([tripToRow(trip('bbbbbbbb-0000-4000-8000-000000000009', 'metro', 4))]);
    });
    await as('authenticated', A, async () => {
      await db.query('select public.delete_my_data()');
      assert.equal((await db.query('select * from public.trips')).rows.length, 0);
    });
    await as('authenticated', B, async () => {
      assert.equal((await db.query('select * from public.trips')).rows.length, 1);
    });
  });

  it('deleting the auth user cascades to all of their rows', async () => {
    await db.exec(`delete from auth.users where id = '${B}'`);
    for (const t of ['trips', 'profiles', 'goals', 'agent_runs', 'trip_tombstones']) {
      const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${t} where user_id = '${B}'`);
      assert.equal(r.rows[0].n, 0, t);
    }
  });
});
