/** Mapping between the domain `Trip` and the `public.trips` row shape used by Supabase. */
import type { Trip } from './types.ts';

export interface TripRow {
  id: string;
  user_id?: string;
  started_at: string;
  ended_at: string;
  distance_km: number;
  mode: string;
  proposed_mode: string | null;
  variant: string | null;
  occupancy: number | null;
  origin_label: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_label: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  detection_source: string;
  classification_confidence: number | null;
  confirmation_status: string;
  dedupe_key: string | null;
  notes: string | null;
  calc_status: string;
  emissions_kg: number | null;
  factor_id: string | null;
  factor_value: number | null;
  factor_unit: string | null;
  factor_set_id: string;
  factor_set_version: string;
  boundary: string | null;
  calc_method: string;
  calc_engine_version: string;
  occupancy_applied: number | null;
  calculated_at: string;
  created_at: string;
  updated_at: string;
  server_updated_at?: string;
  deleted_at?: string | null;
}

export function tripToRow(t: Trip): TripRow {
  return {
    id: t.id,
    started_at: t.startedAt,
    ended_at: t.endedAt,
    distance_km: t.distanceKm,
    mode: t.mode,
    proposed_mode: t.proposedMode,
    variant: t.variant,
    occupancy: t.occupancy,
    origin_label: t.origin?.label ?? null,
    origin_lat: t.origin?.lat ?? null,
    origin_lng: t.origin?.lng ?? null,
    destination_label: t.destination?.label ?? null,
    destination_lat: t.destination?.lat ?? null,
    destination_lng: t.destination?.lng ?? null,
    detection_source: t.detectionSource,
    classification_confidence: t.classificationConfidence,
    confirmation_status: t.confirmationStatus,
    dedupe_key: t.dedupeKey,
    notes: t.notes,
    calc_status: t.calcStatus,
    emissions_kg: t.emissionsKg,
    factor_id: t.factorId,
    factor_value: t.factorValue,
    factor_unit: t.factorUnit,
    factor_set_id: t.factorSetId,
    factor_set_version: t.factorSetVersion,
    boundary: t.boundary,
    calc_method: t.calcMethod,
    calc_engine_version: t.calcEngineVersion,
    occupancy_applied: t.occupancyApplied,
    calculated_at: t.calculatedAt,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    deleted_at: t.deletedAt,
  };
}

const iso = (v: string | Date) => new Date(v).toISOString();
const num = (v: unknown) => (v == null ? null : Number(v));

export function rowToTrip(r: TripRow): Trip {
  const place = (label: string | null, lat: number | null, lng: number | null) =>
    label == null && lat == null && lng == null ? null : { label: label ?? undefined, lat: num(lat) ?? undefined, lng: num(lng) ?? undefined };
  return {
    id: r.id,
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    distanceKm: Number(r.distance_km),
    mode: r.mode as Trip['mode'],
    proposedMode: (r.proposed_mode as Trip['proposedMode']) ?? null,
    variant: r.variant,
    occupancy: num(r.occupancy),
    origin: place(r.origin_label, r.origin_lat, r.origin_lng),
    destination: place(r.destination_label, r.destination_lat, r.destination_lng),
    detectionSource: r.detection_source as Trip['detectionSource'],
    classificationConfidence: num(r.classification_confidence),
    confirmationStatus: r.confirmation_status as Trip['confirmationStatus'],
    dedupeKey: r.dedupe_key,
    notes: r.notes,
    calcStatus: r.calc_status as Trip['calcStatus'],
    emissionsKg: num(r.emissions_kg),
    factorId: r.factor_id,
    factorValue: num(r.factor_value),
    factorUnit: r.factor_unit as Trip['factorUnit'],
    factorSetId: r.factor_set_id,
    factorSetVersion: r.factor_set_version,
    boundary: r.boundary as Trip['boundary'],
    calcMethod: r.calc_method,
    calcEngineVersion: r.calc_engine_version,
    occupancyApplied: num(r.occupancy_applied),
    calculatedAt: iso(r.calculated_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    deletedAt: r.deleted_at ? iso(r.deleted_at) : null,
  };
}
