/**
 * Shared domain types for EcoMove AI.
 *
 * This directory (`supabase/functions/_shared/core`) is the single source of truth for
 * domain logic. It is imported by the mobile app (via the `@core/*` alias), by the
 * Supabase Edge Functions (Deno), and by the Jest test suite. It must stay free of
 * runtime dependencies and platform globals (no React Native, Node or Deno APIs).
 * Imports inside this directory use explicit `.ts` extensions so that Deno can resolve them.
 */

export const TRANSPORT_MODES = [
  'walking',
  'cycling',
  'motorcycle',
  'car',
  'taxi',
  'bus',
  'metro',
  'train',
  'hsr',
  'other_public',
  'unknown',
] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];

export function isTransportMode(value: unknown): value is TransportMode {
  return typeof value === 'string' && (TRANSPORT_MODES as readonly string[]).includes(value);
}

/** kg CO2e per passenger-kilometre, or per vehicle-kilometre (must be divided by occupancy). */
export type FactorUnit = 'kgCO2e/pkm' | 'kgCO2e/vkm';

/**
 * Accounting boundary of an emission factor. Factors with different boundaries are not
 * directly comparable; the analytics layer warns when they are mixed.
 */
export type AccountingBoundary =
  /** Tailpipe / combustion emissions only (DESNZ "direct" passenger-vehicle factors). */
  | 'direct_operational'
  /** Operational emissions incl. electricity generation for traction (DESNZ rail/bus pkm factors). */
  | 'operational_incl_electricity'
  /** ISO 14067-style product carbon footprint covering life-cycle stages (Taiwan carbon labels). */
  | 'lifecycle_product_cfp'
  /** Human-powered modes recorded as zero direct operational emissions by convention. */
  | 'zero_direct_convention';

export type FactorQuality =
  /** Value read directly from the publishing organisation's own published document/dataset. */
  | 'official_primary'
  /** Official value (e.g. a government-approved carbon label) verified via press coverage, not the certificate. */
  | 'official_reported'
  /** Official value from another country, used as a documented proxy for the user's region. */
  | 'official_proxy_other_region'
  /** Accounting convention rather than a measured value (e.g. walking = 0 direct). */
  | 'convention';

export interface EmissionFactor {
  /** Globally unique, stable identifier. Never reused for a different value. */
  id: string;
  /** Originating dataset (e.g. `desnz-2025`, `tw-cfp-labels`). A factor may be used by several factor sets. */
  datasetId: string;
  datasetVersion: string;
  mode: TransportMode;
  /** Sub-type within a mode, e.g. `tra_local` for TRA local trains. */
  variant: string;
  variantLabel: string;
  /** ISO 3166 code or sub-region, e.g. `TW`, `TW-TPE`, `GB`. */
  region: string;
  value: number;
  unit: FactorUnit;
  gasMetric: 'CO2e';
  boundary: AccountingBoundary;
  sourceOrg: string;
  sourceTitle: string;
  sourceUrl: string;
  /** Row ID, certificate number or other locator inside the source. */
  sourceReference?: string;
  publishedDate?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  methodologyNotes: string;
  quality: FactorQuality;
  /** True when the factor comes from a region other than the factor set's primary region. */
  isRegionalProxy: boolean;
}

export interface FactorSet {
  id: string;
  version: string;
  name: string;
  shortName: string;
  description: string;
  primaryRegion: string;
  /** Which variant to use for a mode when the trip does not specify one. */
  defaultVariants: Partial<Record<TransportMode, string>>;
  factors: EmissionFactor[];
  /** True if the set combines factors with different accounting boundaries. */
  mixedBoundaries: boolean;
  caveats: string[];
}

export type DetectionSource = 'manual' | 'auto';

export type ConfirmationStatus =
  /** User entered it manually or explicitly confirmed an automatic classification. */
  | 'confirmed'
  /** Detected automatically; classification is uncertain and awaits the user. */
  | 'needs_review'
  /** Detected automatically and the user changed something. */
  | 'edited'
  /** User marked the detection as irrelevant/accidental. Excluded from all totals. */
  | 'dismissed';

export type CalcStatus = 'calculated' | 'factor_unavailable' | 'invalid_input';

export interface PlaceRef {
  label?: string;
  lat?: number;
  lng?: number;
}

/** Calculation snapshot stored with each trip so historical reports stay reproducible. */
export interface TripCalculation {
  calcStatus: CalcStatus;
  emissionsKg: number | null;
  factorId: string | null;
  factorValue: number | null;
  factorUnit: FactorUnit | null;
  factorSetId: string;
  factorSetVersion: string;
  boundary: AccountingBoundary | null;
  calcMethod: string;
  calcEngineVersion: string;
  occupancyApplied: number | null;
  calculatedAt: string;
}

export interface Trip extends TripCalculation {
  id: string;
  startedAt: string;
  endedAt: string;
  distanceKm: number;
  mode: TransportMode;
  /** The mode proposed by the classifier (auto trips only). */
  proposedMode: TransportMode | null;
  variant: string | null;
  /** People in the vehicle including the user (car/motorcycle only). */
  occupancy: number | null;
  origin: PlaceRef | null;
  destination: PlaceRef | null;
  detectionSource: DetectionSource;
  classificationConfidence: number | null;
  confirmationStatus: ConfirmationStatus;
  /** Idempotency key used to prevent duplicate trips from overlapping detections. */
  dedupeKey: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type PeriodKind = 'day' | 'week' | 'month' | 'year';

export interface PeriodRange {
  kind: PeriodKind;
  /** Inclusive start instant (UTC ISO). */
  start: string;
  /** Exclusive end instant (UTC ISO). */
  end: string;
  /** Local calendar key, e.g. `2026-10-10`, `2026-W41`, `2026-10`, `2026`. */
  key: string;
  timeZone: string;
}

export interface UserPreferences {
  timeZone: string;
  factorSetId: string;
  /** Default number of occupants (incl. user) for private car trips. */
  defaultCarOccupancy: number;
  defaultMotorcycleOccupancy: number;
  /** Max extra minutes the user accepts vs. driving when looking for alternatives. */
  maxExtraMinutes: number | null;
  preferredModes: TransportMode[];
  avoidModes: TransportMode[];
  accessibilityNotes: string | null;
  units: 'metric';
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  timeZone: 'Asia/Taipei',
  factorSetId: 'ecomove-tw-hybrid',
  defaultCarOccupancy: 1,
  defaultMotorcycleOccupancy: 1,
  maxExtraMinutes: 15,
  preferredModes: [],
  avoidModes: [],
  accessibilityNotes: null,
  units: 'metric',
};
