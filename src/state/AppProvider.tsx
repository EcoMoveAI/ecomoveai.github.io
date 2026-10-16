import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { getFactorSetOrDefault } from '@core/factors.ts';
import { evaluateGoal, GOAL_META, type Goal } from '@core/goals.ts';
import { isValidTimeZone } from '@core/time.ts';
import { applyTripEdit, buildManualTrip, confirmTrip, dismissTrip, recalculateTrip, type TripInput, type TripPatch } from '@core/trips.ts';
import type { Trip, UserPreferences } from '@core/types.ts';
import { isCloudConfigured } from '@/config';
import type { AppSettings, Repository, StoredTrip } from '@/db/repository';
import { getRepository } from '@/db/shared';
import { deleteCloudAccount } from '@/services/api';
import { newId } from '@/services/ids';
import { parseImport } from '@/services/importData';
import { applyNotificationSchedule, deliverDueReminders, notifyGoalProgress } from '@/services/notifications';
import { supabase } from '@/services/supabase';
import { createSupabaseRemote } from '@/sync/supabaseRemote';
import { syncAll } from '@/sync/syncEngine';
import { onDataChanged } from './events';

export interface SyncState {
  pending: number;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  syncing: boolean;
  lastError: string | null;
}

interface AppContextValue {
  ready: boolean;
  repo: Repository | null;
  settings: AppSettings;
  prefs: UserPreferences;
  trips: StoredTrip[];
  goals: Goal[];
  session: Session | null;
  sync: SyncState;
  /** True when this device syncs with a signed-in cloud account. */
  cloudActive: boolean;
  refresh(): Promise<void>;
  addTrip(input: TripInput): Promise<Trip>;
  editTrip(id: string, patch: TripPatch): Promise<Trip>;
  confirmTrip(id: string): Promise<void>;
  dismissTrip(id: string): Promise<void>;
  deleteTrip(id: string): Promise<void>;
  setPreferences(p: UserPreferences): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  recalculateAll(factorSetId: string): Promise<number>;
  saveGoal(goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & { id?: string }): Promise<void>;
  deleteGoal(id: string): Promise<void>;
  syncNow(): Promise<void>;
  signOut(): Promise<void>;
  deleteAllData(): Promise<void>;
  deleteAccount(): Promise<void>;
  /** Imports an EcoMove JSON export (e.g. from the mobile app). Never overwrites newer local records. */
  importData(text: string): Promise<ImportSummary>;
}

export interface ImportSummary {
  tripsAdded: number;
  tripsUpdated: number;
  goalsImported: number;
  unchanged: number;
  skipped: number;
  problems: string[];
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

const DEFAULT_SYNC: SyncState = { pending: 0, lastSyncAt: null, lastSyncOk: null, syncing: false, lastError: null };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [trips, setTrips] = useState<StoredTrip[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [sync, setSync] = useState<SyncState>(DEFAULT_SYNC);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncing = useRef(false);
  const backoffMs = useRef(5_000);

  const cloudActive = !!(isCloudConfigured && settings?.accountMode === 'cloud' && session);

  const refresh = useCallback(async () => {
    const r = repo ?? (await getRepository());
    const [s, p, t, g, pending, last] = await Promise.all([
      r.getSettings(),
      r.getPreferences(),
      r.listTrips(),
      r.listGoals(),
      r.countPending(),
      r.getKv<{ at: string; ok: boolean } | null>('last_sync', null),
    ]);
    setSettings(s);
    setPrefs(p);
    setTrips(t);
    setGoals(g);
    setSync((prev) => ({ ...prev, pending, lastSyncAt: last?.at ?? null, lastSyncOk: last?.ok ?? null }));
  }, [repo]);

  // ---------------------------------------------------------------- init
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await getRepository();
      if (cancelled) return;
      setRepo(r);
      await applyRetention(r);
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
      }
      const [s, p, t, g, pending] = await Promise.all([r.getSettings(), r.getPreferences(), r.listTrips(), r.listGoals(), r.countPending()]);
      setSettings(s);
      setPrefs(p);
      setTrips(t);
      setGoals(g);
      setSync((prev) => ({ ...prev, pending }));
      setReady(true);
    })();
    const sub = supabase?.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      cancelled = true;
      sub?.data.subscription.unsubscribe();
    };
  }, []);

  // ---------------------------------------------------------------- sync
  const runSync = useCallback(async () => {
    if (!repo || !supabase || !cloudActive || syncing.current) return;
    syncing.current = true;
    setSync((s) => ({ ...s, syncing: true }));
    try {
      const res = await syncAll(repo, createSupabaseRemote(supabase));
      backoffMs.current = res.errors.length ? Math.min(backoffMs.current * 2, 10 * 60_000) : 5_000;
      setSync((s) => ({ ...s, lastError: res.errors[0] ?? null }));
      if (res.errors.length) {
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => void runSync(), backoffMs.current);
      }
    } finally {
      syncing.current = false;
      setSync((s) => ({ ...s, syncing: false }));
      await refresh();
    }
  }, [repo, cloudActive, refresh]);

  const scheduleSync = useCallback(() => {
    if (!cloudActive) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void runSync(), 1500);
  }, [cloudActive, runSync]);

  useEffect(() => {
    if (cloudActive) void runSync();
  }, [cloudActive, runSync]);

  // Pull the server-side profile once after sign-in.
  useEffect(() => {
    if (!cloudActive || !supabase || !repo) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('*').maybeSingle();
      if (!data) return;
      const local = await repo.getPreferences();
      const merged: UserPreferences = {
        ...local,
        timeZone: isValidTimeZone(data.time_zone) ? data.time_zone : local.timeZone,
        factorSetId: data.factor_set_id ?? local.factorSetId,
        defaultCarOccupancy: data.default_car_occupancy ?? local.defaultCarOccupancy,
        defaultMotorcycleOccupancy: data.default_motorcycle_occupancy ?? local.defaultMotorcycleOccupancy,
        maxExtraMinutes: data.max_extra_minutes ?? local.maxExtraMinutes,
        preferredModes: data.preferred_modes ?? local.preferredModes,
        avoidModes: data.avoid_modes ?? local.avoidModes,
        accessibilityNotes: data.accessibility_notes ?? local.accessibilityNotes,
      };
      await repo.setPreferences(merged);
      setPrefs(merged);
    })().catch(() => undefined);
  }, [cloudActive, repo]);

  useEffect(() => {
    const unsubscribe = onDataChanged(() => {
      void refresh();
      scheduleSync();
    });
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
        scheduleSync();
      }
    });
    // Browser: upload the offline queue as soon as connectivity returns.
    const onOnline = () => scheduleSync();
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', onOnline);
    return () => {
      unsubscribe();
      appSub.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    };
  }, [refresh, scheduleSync]);

  // Browser reminders cannot be scheduled while the site is closed; show any that became due on open.
  useEffect(() => {
    if (!ready || !repo || !settings) return;
    const check = async () => {
      const last = await repo.getKv<Record<string, string>>('reminders_last_shown', {});
      const next = await deliverDueReminders(settings.notifications, last, new Date());
      if (JSON.stringify(next) !== JSON.stringify(last)) await repo.setKv('reminders_last_shown', next);
    };
    void check().catch(() => undefined);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check().catch(() => undefined);
    });
    return () => sub.remove();
  }, [ready, repo, settings]);

  // ---------------------------------------------------------------- helpers
  const requireRepo = useCallback(() => {
    if (!repo || !prefs || !settings) throw new Error('App not ready');
    return { repo, prefs, settings };
  }, [repo, prefs, settings]);

  const afterChange = useCallback(async () => {
    await refresh();
    scheduleSync();
  }, [refresh, scheduleSync]);

  const checkGoalNotifications = useCallback(async () => {
    const { repo: r, prefs: p, settings: s } = requireRepo();
    if (!s.notifications.goalProgress) return;
    const all = await r.listTrips();
    for (const g of await r.listGoals()) {
      if (g.status !== 'active') continue;
      const progress = evaluateGoal(g, all, new Date(), p.timeZone);
      const key = `goal_notified_${g.id}_${progress.periodKey}`;
      const nearLimit = g.type.startsWith('max_') ? progress.progress >= 0.8 && progress.status !== 'not_met' : progress.status === 'achieved';
      if (nearLimit && !(await r.getKv<boolean>(key, false))) {
        await r.setKv(key, true);
        await notifyGoalProgress(g.type.startsWith('max_') ? `You're close to your limit for "${GOAL_META[g.type].title}"` : `Goal reached: ${GOAL_META[g.type].title}`);
      }
    }
  }, [requireRepo]);

  // ---------------------------------------------------------------- actions
  // (Memoisation is handled by the React Compiler.)
  if (!settings || !prefs) return null;
  const set = getFactorSetOrDefault(prefs.factorSetId);
  const value: AppContextValue = {
      ready,
      repo,
      settings,
      prefs,
      trips,
      goals,
      session,
      sync,
      cloudActive,
      refresh,
      async addTrip(input) {
        const { repo: r, settings: s } = requireRepo();
        const { trip } = buildManualTrip(input, { id: newId(), now: new Date(), set, keepPreciseCoords: s.keepPreciseCoords });
        await r.saveTrip(trip);
        await afterChange();
        void checkGoalNotifications().catch(() => undefined);
        return trip;
      },
      async editTrip(id, patch) {
        const { repo: r, settings: s } = requireRepo();
        const t = await r.getTrip(id);
        if (!t) throw new Error('Trip not found');
        const { trip } = applyTripEdit(t, patch, { now: new Date(), set, keepPreciseCoords: s.keepPreciseCoords });
        await r.saveTrip(trip);
        await afterChange();
        return trip;
      },
      async confirmTrip(id) {
        const { repo: r } = requireRepo();
        const t = await r.getTrip(id);
        if (!t) return;
        await r.saveTrip(confirmTrip(t, new Date()));
        await afterChange();
      },
      async dismissTrip(id) {
        const { repo: r } = requireRepo();
        const t = await r.getTrip(id);
        if (!t) return;
        await r.saveTrip(dismissTrip(t, new Date()));
        await afterChange();
      },
      async deleteTrip(id) {
        const { repo: r } = requireRepo();
        // With a cloud account a content-free tombstone is synced, then removed; on-device mode deletes immediately.
        if (cloudActive) await r.softDeleteTrip(id, new Date());
        else await r.hardDeleteTrip(id);
        await afterChange();
      },
      async setPreferences(p) {
        const { repo: r } = requireRepo();
        if (!isValidTimeZone(p.timeZone)) throw new Error(`Unknown time zone "${p.timeZone}".`);
        await r.setPreferences(p);
        setPrefs(p);
        if (cloudActive && supabase) {
          await supabase.from('profiles').update({
            time_zone: p.timeZone,
            factor_set_id: p.factorSetId,
            default_car_occupancy: p.defaultCarOccupancy,
            default_motorcycle_occupancy: p.defaultMotorcycleOccupancy,
            max_extra_minutes: p.maxExtraMinutes,
            preferred_modes: p.preferredModes,
            avoid_modes: p.avoidModes,
            accessibility_notes: p.accessibilityNotes,
          }).eq('user_id', session?.user.id ?? '');
        }
      },
      async updateSettings(patch) {
        const { repo: r } = requireRepo();
        const next = await r.updateSettings(patch);
        setSettings(next);
        if (patch.notifications) await applyNotificationSchedule(next.notifications);
      },
      async recalculateAll(factorSetId) {
        const { repo: r, prefs: p } = requireRepo();
        const target = getFactorSetOrDefault(factorSetId);
        const now = new Date();
        const all = await r.listTrips();
        for (const t of all) await r.saveTrip(recalculateTrip(t, target, now));
        const nextPrefs = { ...p, factorSetId: target.id };
        await r.setPreferences(nextPrefs);
        setPrefs(nextPrefs);
        await afterChange();
        return all.length;
      },
      async saveGoal(g) {
        const { repo: r } = requireRepo();
        const now = new Date().toISOString();
        const existing = g.id ? await r.getGoal(g.id) : null;
        await r.saveGoal({ id: g.id ?? newId(), type: g.type, targetValue: g.targetValue, period: g.period, status: g.status, createdAt: existing?.createdAt ?? now, updatedAt: now, deletedAt: null });
        await afterChange();
      },
      async deleteGoal(id) {
        const { repo: r } = requireRepo();
        const g = await r.getGoal(id);
        if (!g) return;
        if (cloudActive) await r.saveGoal({ ...g, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        else await r.hardDeleteGoal(id);
        await afterChange();
      },
      async syncNow() {
        await runSync();
      },
      async signOut() {
        const { repo: r } = requireRepo();
        if (cloudActive) {
          await runSync(); // try to upload pending changes first
          // Signing out wipes local data, so never do it while changes exist only on this device.
          const left = await r.countPending();
          if (left > 0) throw new Error(`${left} change(s) have not been uploaded yet. Connect to the internet and sync before signing out, or export your data first.`);
        }
        await supabase?.auth.signOut();
        await r.wipePersonalData();
        await r.updateSettings({ accountMode: null, onboardingComplete: false });
        await refresh();
      },
      async deleteAllData() {
        const { repo: r } = requireRepo();
        if (cloudActive && supabase) {
          const { error } = await supabase.rpc('delete_my_data');
          if (error) throw new Error('Could not delete cloud data. Check your connection and try again.');
        }
        await r.wipePersonalData();
        await refresh();
      },
      async deleteAccount() {
        const { repo: r } = requireRepo();
        if (cloudActive) {
          await deleteCloudAccount();
          await supabase?.auth.signOut();
        }
        await applyNotificationSchedule({ dailySummary: false, weeklyInsight: false, monthlyReport: false, goalProgress: false });
        await r.wipeEverything();
        await refresh();
      },
      async importData(text) {
        const { repo: r } = requireRepo();
        const parsed = parseImport(text);
        const summary: ImportSummary = { tripsAdded: 0, tripsUpdated: 0, goalsImported: 0, unchanged: 0, skipped: parsed.skipped, problems: parsed.problems };
        await r.transactionally(async () => {
          for (const t of parsed.trips) {
            const existing = await r.getTrip(t.id);
            // Same last-write-wins rule as sync: never replace a newer local version.
            if (existing && Date.parse(existing.updatedAt) >= Date.parse(t.updatedAt)) {
              summary.unchanged += 1;
              continue;
            }
            if (t.dedupeKey) {
              const dup = await r.findByDedupeKey(t.dedupeKey);
              if (dup && dup.id !== t.id) {
                summary.unchanged += 1;
                continue;
              }
            }
            await r.saveTrip(t, 'pending');
            if (existing) summary.tripsUpdated += 1;
            else summary.tripsAdded += 1;
          }
          for (const g of parsed.goals) {
            const existing = await r.getGoal(g.id);
            if (existing && Date.parse(existing.updatedAt) >= Date.parse(g.updatedAt)) {
              summary.unchanged += 1;
              continue;
            }
            await r.saveGoal(g, 'pending');
            summary.goalsImported += 1;
          }
        });
        await afterChange();
        return summary;
      },
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** Applies the user's trip-retention setting by deleting trips older than the cutoff. */
async function applyRetention(r: Repository): Promise<void> {
  const s = await r.getSettings();
  if (!s.tripRetentionMonths) return;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - s.tripRetentionMonths);
  const ids = await r.tripsOlderThan(cutoff.toISOString());
  for (const id of ids) {
    if (s.accountMode === 'cloud') await r.softDeleteTrip(id, new Date());
    else await r.hardDeleteTrip(id);
  }
}
