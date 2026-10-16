/**
 * @jest-environment node
 *
 * Integration tests for the on-device data layer: the real Repository on SQLite (sql.js), the tracking
 * pipeline, and the sync engine against an in-memory server with the same conflict rules as the backend.
 */
import { INITIAL_DETECTOR_STATE, type LocationSample } from '@core/detection.ts';
import { getFactorSetOrDefault } from '@core/factors.ts';
import { summarize } from '@core/analytics.ts';
import { periodRange } from '@core/time.ts';
import { applyTripEdit, buildManualTrip } from '@core/trips.ts';
import { Repository } from '@/db/repository';
import { syncAll } from '@/sync/syncEngine';
import { flushTracking, ingestSamples } from '@/tracking/pipeline';
import { FakeRemote } from './fakeRemote';
import { createSqlJsDriver } from './sqljsDriver';

const SET = getFactorSetOrDefault('ecomove-tw-hybrid');
let n = 0;
const deps = { now: () => new Date('2026-10-10T06:00:00Z'), newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };

async function newRepo() {
  const r = new Repository(await createSqlJsDriver());
  await r.migrate();
  return r;
}

function manual(id: string, mode: 'car' | 'metro' | 'bus', km: number, start = '2026-10-10T01:00:00Z', now = new Date('2026-10-10T02:00:00Z')) {
  return buildManualTrip(
    { startedAt: start, endedAt: new Date(Date.parse(start) + 20 * 60000).toISOString(), distanceKm: km, mode },
    { id, now, set: SET, keepPreciseCoords: false },
  ).trip;
}

describe('Repository (SQLite)', () => {
  it('runs migrations idempotently and returns default settings', async () => {
    const r = await newRepo();
    await r.migrate();
    expect((await r.getSettings()).trackingEnabled).toBe(false);
    expect((await r.getPreferences()).timeZone).toBe('Asia/Taipei');
    expect(await r.getDetectorState()).toEqual(INITIAL_DETECTOR_STATE);
  });

  it('persists trips, filters by window and keeps them pending until synced', async () => {
    const r = await newRepo();
    const t = manual('a1', 'car', 10);
    await r.saveTrip(t);
    await r.saveTrip(manual('a2', 'metro', 5, '2026-10-11T01:00:00Z', new Date('2026-10-11T02:00:00Z')));
    expect(await r.listTrips({ start: '2026-10-10T00:00:00Z', end: '2026-10-11T00:00:00Z' })).toHaveLength(1);
    expect((await r.getTrip('a1'))?.emissionsKg).toBeCloseTo(1.6725);
    expect(await r.countPending()).toBe(2);
    await r.markTripSynced('a1', t.updatedAt);
    expect((await r.getTrip('a1'))?.syncStatus).toBe('synced');
  });

  it('does not mark a trip synced if it was edited after being pushed', async () => {
    const r = await newRepo();
    const t = manual('b1', 'car', 10);
    await r.saveTrip(t);
    const pushedVersion = t.updatedAt;
    const { trip: edited } = applyTripEdit(t, { mode: 'bus' }, { now: new Date('2026-10-10T03:00:00Z'), set: SET, keepPreciseCoords: false });
    await r.saveTrip(edited);
    await r.markTripSynced('b1', pushedVersion);
    expect((await r.getTrip('b1'))?.syncStatus).toBe('pending');
  });

  it('soft delete erases trip content and hides it; wipe removes personal data', async () => {
    const r = await newRepo();
    await r.saveTrip({ ...manual('c1', 'car', 3), origin: { label: 'Home' }, notes: 'secret' });
    await r.softDeleteTrip('c1', new Date('2026-10-10T05:00:00Z'));
    expect(await r.listTrips()).toHaveLength(0);
    const tomb = (await r.listTrips({ includeDeleted: true }))[0];
    expect(tomb.origin).toBeNull();
    expect(tomb.notes).toBeNull();
    await r.wipePersonalData();
    expect(await r.listTrips({ includeDeleted: true })).toHaveLength(0);
  });
});

/** 5 min resting, 15 min walking north at 5 km/h, 8 min resting. */
function walkSamples(t0: number): LocationSample[] {
  const out: LocationSample[] = [];
  const lat0 = 25.0478;
  for (let s = 0; s <= 300; s += 30) out.push({ ts: t0 + s * 1000, lat: lat0, lng: 121.517, accuracyM: 10, speedMps: 0 });
  let lat = lat0;
  for (let s = 30; s <= 900; s += 30) {
    lat = lat0 + ((5 * s) / 3600) / 111.195;
    out.push({ ts: t0 + 300_000 + s * 1000, lat, lng: 121.517, accuracyM: 10, speedMps: 5 / 3.6 });
  }
  for (let s = 30; s <= 480; s += 30) out.push({ ts: t0 + 1_200_000 + s * 1000, lat, lng: 121.517, accuracyM: 10, speedMps: 0 });
  return out;
}

describe('tracking pipeline', () => {
  const t0 = Date.parse('2026-10-10T00:00:00Z');

  it('detects, classifies, calculates and saves a trip; duplicate deliveries do not create duplicates', async () => {
    const r = await newRepo();
    const samples = walkSamples(t0);
    const saved = await ingestSamples(r, samples, deps);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ mode: 'walking', detectionSource: 'auto', confirmationStatus: 'confirmed', calcStatus: 'calculated', emissionsKg: 0 });
    expect(saved[0].origin?.lat).toBe(25.048); // rounded for privacy
    // The OS re-delivers the same batch, and a second session reports the same journey.
    await r.setDetectorState(INITIAL_DETECTOR_STATE);
    expect(await ingestSamples(r, samples, deps)).toHaveLength(0);
    const shifted = samples.map((s) => ({ ...s, ts: s.ts + 20_000 }));
    await r.setDetectorState(INITIAL_DETECTOR_STATE);
    expect(await ingestSamples(r, shifted, deps)).toHaveLength(0);
    expect(await r.listTrips()).toHaveLength(1);
  });

  it('skips an automatic detection that overlaps a manually entered trip', async () => {
    const r = await newRepo();
    await r.saveTrip(manual('m1', 'bus', 1.2, '2026-10-10T00:05:00Z', new Date('2026-10-10T01:00:00Z')));
    expect(await ingestSamples(r, walkSamples(t0), deps)).toHaveLength(0);
  });

  it('closes the trip in progress when tracking stops and clears raw samples', async () => {
    const r = await newRepo();
    const partial = walkSamples(t0).slice(0, 35); // still walking
    expect(await ingestSamples(r, partial, deps)).toHaveLength(0);
    expect((await r.getDetectorState()).tripSamples.length).toBeGreaterThan(0);
    const saved = await flushTracking(r, deps);
    expect(saved).toHaveLength(1);
    expect((await r.getDetectorState()).tripSamples).toHaveLength(0);
  });
});

describe('offline sync', () => {
  it('queues offline changes, retries safely after a failure and never duplicates', async () => {
    const remote = new FakeRemote();
    const phone = await newRepo();
    await phone.saveTrip(manual('11111111-0000-4000-8000-000000000001', 'car', 10));
    await phone.saveTrip(manual('11111111-0000-4000-8000-000000000002', 'metro', 8));

    remote.failNext = 1;
    const first = await syncAll(phone, remote);
    expect(first.errors[0]).toMatch(/network/);
    expect(await phone.countPending()).toBe(2);
    expect(remote.trips.size).toBe(0);

    const second = await syncAll(phone, remote);
    expect(second.errors).toEqual([]);
    expect(second.pushed).toBe(2);
    expect(await phone.countPending()).toBe(0);

    await syncAll(phone, remote); // nothing pending: no duplicates, no extra push
    expect(remote.trips.size).toBe(2);
  });

  it('propagates trips, edits and deletions between two devices with last-write-wins', async () => {
    const remote = new FakeRemote();
    const a = await newRepo();
    const b = await newRepo();
    const id = '22222222-0000-4000-8000-000000000001';
    const t = manual(id, 'car', 10);
    await a.saveTrip(t);
    await syncAll(a, remote);
    await syncAll(b, remote);
    expect((await b.getTrip(id))?.mode).toBe('car');
    expect((await b.getTrip(id))?.syncStatus).toBe('synced');

    // Both devices edit offline; B's edit is later and must win everywhere.
    const { trip: editA } = applyTripEdit(t, { mode: 'metro' }, { now: new Date('2026-10-10T03:00:00Z'), set: SET, keepPreciseCoords: false });
    const { trip: editB } = applyTripEdit(t, { mode: 'bus' }, { now: new Date('2026-10-10T04:00:00Z'), set: SET, keepPreciseCoords: false });
    await a.saveTrip(editA);
    await b.saveTrip(editB);
    await syncAll(b, remote);
    const resA = await syncAll(a, remote);
    expect(resA.rejectedAsStale).toBe(1);
    expect((await a.getTrip(id))?.mode).toBe('bus');
    expect(remote.trips.get(id)?.mode).toBe('bus');

    // Deletion on A reaches B and is removed from A after upload.
    await a.softDeleteTrip(id, new Date('2026-10-10T05:00:00Z'));
    await syncAll(a, remote);
    expect(await a.getTrip(id)).toBeNull();
    await syncAll(b, remote);
    expect(await b.getTrip(id)).toBeNull();
  });

  it('does not let a pull overwrite a newer local edit that has not been uploaded yet', async () => {
    const remote = new FakeRemote();
    const a = await newRepo();
    const id = '33333333-0000-4000-8000-000000000001';
    const t = manual(id, 'car', 10);
    await a.saveTrip(t);
    await syncAll(a, remote);
    const { trip: newer } = applyTripEdit(t, { distanceKm: 12 }, { now: new Date('2026-10-10T09:00:00Z'), set: SET, keepPreciseCoords: false });
    await a.saveTrip(newer);
    remote.failNext = 1; // push fails, pull then runs against the older server copy
    await syncAll(a, remote);
    expect((await a.getTrip(id))?.distanceKm).toBe(12);
    expect((await a.getTrip(id))?.syncStatus).toBe('pending');
  });

  it('dashboards recompute from records after edits and deletions', async () => {
    const r = await newRepo();
    await r.saveTrip(manual('d1', 'car', 10));
    await r.saveTrip(manual('d2', 'metro', 10, '2026-10-10T03:00:00Z', new Date('2026-10-10T04:00:00Z')));
    const day = periodRange('day', '2026-10-10T04:00:00Z', 'Asia/Taipei');
    expect(summarize(await r.listTrips(), day, 'Asia/Taipei').emissionsKg).toBeCloseTo(1.6725 + 0.75);
    await r.hardDeleteTrip('d1');
    expect(summarize(await r.listTrips(), day, 'Asia/Taipei').emissionsKg).toBeCloseTo(0.75);
  });
});
