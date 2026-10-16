/**
 * Personal, user-selected mobility goals. Targets are the user's own choices, compared against their own
 * history; they are not scientific thresholds. Messaging is supportive and never shaming, and goals are
 * framed so that necessary travel is not "penalised".
 */
import { formatKg } from './calc.ts';
import { summarize, tripsInWindow } from './analytics.ts';
import { MODE_INFO } from './modes.ts';
import { periodRange, shiftPeriod } from './time.ts';
import type { Trip } from './types.ts';

export const GOAL_TYPES = [
  'reduce_emissions_pct',
  'max_taxi_trips',
  'max_short_motorised_trips',
  'min_public_transport_trips',
  'min_active_trips',
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export interface Goal {
  id: string;
  type: GoalType;
  targetValue: number;
  period: 'week' | 'month';
  status: 'active' | 'paused' | 'archived';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const GOAL_META: Record<GoalType, { title: string; unit: string; describe: (v: number) => string; min: number; max: number }> = {
  reduce_emissions_pct: { title: 'Reduce mobility emissions', unit: '%', describe: (v) => `Reduce recorded emissions by ${v}% vs. my recent average`, min: 1, max: 90 },
  max_taxi_trips: { title: 'Fewer taxi trips', unit: 'trips', describe: (v) => `At most ${v} taxi / ride-hailing trips`, min: 0, max: 200 },
  max_short_motorised_trips: { title: 'Fewer short motorised trips', unit: 'trips', describe: (v) => `At most ${v} car, taxi or scooter trips of 3 km or less`, min: 0, max: 200 },
  min_public_transport_trips: { title: 'More public transport', unit: 'trips', describe: (v) => `At least ${v} bus, MRT or train trips`, min: 1, max: 300 },
  min_active_trips: { title: 'More walking & cycling', unit: 'trips', describe: (v) => `At least ${v} walking or cycling trips`, min: 1, max: 300 },
};

export function validateGoal(g: Pick<Goal, 'type' | 'targetValue' | 'period'>): string[] {
  const errors: string[] = [];
  if (!(GOAL_TYPES as readonly string[]).includes(g.type)) return ['Unknown goal type.'];
  const meta = GOAL_META[g.type];
  if (!Number.isFinite(g.targetValue) || g.targetValue < meta.min || g.targetValue > meta.max) errors.push(`Target must be between ${meta.min} and ${meta.max} ${meta.unit}.`);
  if (g.type !== 'reduce_emissions_pct' && !Number.isInteger(g.targetValue)) errors.push('Trip targets must be whole numbers.');
  if (g.period !== 'week' && g.period !== 'month') errors.push('Period must be week or month.');
  return errors;
}

export type GoalStatus = 'on_track' | 'at_risk' | 'achieved' | 'not_met' | 'insufficient_data';

export interface GoalProgress {
  goal: Goal;
  periodKey: string;
  current: number;
  target: number;
  unit: string;
  /** For emissions goals: baseline kg per period (average of up to 3 previous complete periods). */
  baselineKg: number | null;
  baselinePeriods: number;
  elapsedFraction: number;
  status: GoalStatus;
  /** 0–1 progress for a progress bar. */
  progress: number;
  message: string;
  disclaimer: string;
}

const DISCLAIMER = 'This is a personal target you chose and is compared with your own history; it is not a scientific or official threshold.';

function countTrips(trips: Trip[], w: { start: string; end: string }, pred: (t: Trip) => boolean): number {
  return tripsInWindow(trips, w).filter(pred).length;
}

export function evaluateGoal(goal: Goal, trips: Trip[], now: Date | number | string, timeZone: string): GoalProgress {
  const range = periodRange(goal.period, now, timeZone);
  const nowMs = new Date(now).getTime();
  const elapsedFraction = Math.min(1, Math.max(0, (nowMs - Date.parse(range.start)) / (Date.parse(range.end) - Date.parse(range.start))));
  const toDate = { start: range.start, end: new Date(Math.min(nowMs, Date.parse(range.end))).toISOString() };
  const meta = GOAL_META[goal.type];
  const base = { goal, periodKey: range.key, target: goal.targetValue, unit: meta.unit, elapsedFraction, disclaimer: DISCLAIMER };

  if (goal.type === 'reduce_emissions_pct') {
    const prev: number[] = [];
    let r = shiftPeriod(range, -1);
    for (let i = 0; i < 3; i++) {
      const s = summarize(trips, r, timeZone);
      if (s.calculatedTrips > 0) prev.push(s.emissionsKg);
      r = shiftPeriod(r, -1);
    }
    const current = summarize(trips, toDate, timeZone).emissionsKg;
    if (!prev.length) {
      return { ...base, current, baselineKg: null, baselinePeriods: 0, status: 'insufficient_data', progress: 0, message: `A baseline needs at least one earlier ${goal.period} with recorded trips. Keep logging and progress will appear here.` };
    }
    const baselineKg = prev.reduce((a, b) => a + b, 0) / prev.length;
    const allowance = baselineKg * (1 - goal.targetValue / 100);
    const projected = elapsedFraction > 0.05 ? current / elapsedFraction : current;
    let status: GoalStatus;
    if (elapsedFraction >= 1) status = current <= allowance ? 'achieved' : 'not_met';
    else status = projected <= allowance ? 'on_track' : 'at_risk';
    const message =
      status === 'achieved' ? `You stayed within ${formatKg(allowance)} — ${goal.targetValue}% below your baseline of ${formatKg(baselineKg)}.`
      : status === 'not_met' ? `This ${goal.period} ended at ${formatKg(current)} against a target of ${formatKg(allowance)}. Necessary trips happen — the next ${goal.period} is a fresh start.`
      : status === 'on_track' ? `${formatKg(current)} so far; at this pace you would finish around ${formatKg(projected)}, within your ${formatKg(allowance)} target.`
      : `${formatKg(current)} so far; at this pace you would finish around ${formatKg(projected)}, above your ${formatKg(allowance)} target. Small swaps on short trips can help, where practical.`;
    return { ...base, current, baselineKg, baselinePeriods: prev.length, status, progress: allowance > 0 ? Math.min(1, current / allowance) : 1, message };
  }

  const preds: Record<Exclude<GoalType, 'reduce_emissions_pct'>, (t: Trip) => boolean> = {
    max_taxi_trips: (t) => t.mode === 'taxi',
    max_short_motorised_trips: (t) => MODE_INFO[t.mode].isPrivateMotorised && t.distanceKm <= 3,
    min_public_transport_trips: (t) => MODE_INFO[t.mode].isPublicTransport,
    min_active_trips: (t) => MODE_INFO[t.mode].isActiveTravel,
  };
  const type = goal.type as Exclude<GoalType, 'reduce_emissions_pct'>;
  const current = countTrips(trips, toDate, preds[type]);
  const isMax = type.startsWith('max_');
  let status: GoalStatus;
  let message: string;
  if (isMax) {
    if (current > goal.targetValue) {
      status = elapsedFraction >= 1 ? 'not_met' : 'at_risk';
      message = `${current} so far vs. a limit of ${goal.targetValue}. That's okay — some trips are necessary. Consider alternatives where they're practical.`;
    } else {
      status = elapsedFraction >= 1 ? 'achieved' : 'on_track';
      message = `${current} of at most ${goal.targetValue} this ${goal.period}.`;
    }
  } else if (current >= goal.targetValue) {
    status = 'achieved';
    message = `Target reached: ${current} trips (goal ${goal.targetValue}).`;
  } else {
    const expected = goal.targetValue * elapsedFraction;
    status = elapsedFraction >= 1 ? 'not_met' : current >= expected * 0.8 ? 'on_track' : 'at_risk';
    message = `${current} of ${goal.targetValue} trips so far this ${goal.period}.`;
  }
  const progress = isMax ? (goal.targetValue === 0 ? (current === 0 ? 0 : 1) : Math.min(1, current / goal.targetValue)) : Math.min(1, current / Math.max(1, goal.targetValue));
  return { ...base, current, baselineKg: null, baselinePeriods: 0, status, progress, message };
}
