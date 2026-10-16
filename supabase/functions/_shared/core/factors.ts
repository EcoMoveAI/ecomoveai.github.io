/**
 * Versioned emission-factor datasets.
 *
 * RULES FOR EDITING THIS FILE (see docs/METHODOLOGY.md):
 *  1. Every numeric value must be traceable to the cited source (URL + row/certificate reference).
 *  2. Never change the `value` of an existing factor id. Add a new factor with a new id and
 *     bump the factor-set version instead, so historical calculations remain reproducible.
 *  3. After editing, run `npm run gen:factor-seed` to regenerate the database seed migration.
 *
 * Values were checked on 2026-10-10 against:
 *  - UK DESNZ "Greenhouse gas reporting: conversion factors 2025" flat file (published 10 June 2025).
 *  - Taipei Metro carbon-footprint page (inventory year 2024, label effective 2025-10-05).
 *  - Taiwan High Speed Rail carbon-footprint page (certificate 碳標字第2014910001-01號).
 *  - Press coverage of TRA's MOENV-approved carbon-footprint labels (approved 2025-06-25).
 */
import type { AccountingBoundary, EmissionFactor, FactorSet, TransportMode } from './types.ts';

const DESNZ_2025_URL = 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025';
const DESNZ_2025_TITLE = 'Greenhouse gas reporting: conversion factors 2025 (flat file, "Business travel- land" tab)';
const DESNZ_ORG = 'UK Department for Energy Security and Net Zero (DESNZ)';

function desnz(
  partial: Pick<EmissionFactor, 'id' | 'mode' | 'variant' | 'variantLabel' | 'value' | 'unit' | 'boundary' | 'sourceReference' | 'methodologyNotes'>,
): EmissionFactor {
  return {
    datasetId: 'desnz-2025',
    datasetVersion: '2025 (v1.0, published 2025-06-10)',
    region: 'GB',
    gasMetric: 'CO2e',
    sourceOrg: DESNZ_ORG,
    sourceTitle: DESNZ_2025_TITLE,
    sourceUrl: DESNZ_2025_URL,
    publishedDate: '2025-06-10',
    effectiveFrom: '2025-01-01',
    effectiveTo: '2025-12-31',
    quality: 'official_primary',
    isRegionalProxy: false,
    ...partial,
  };
}

function zero(id: string, mode: TransportMode, label: string): EmissionFactor {
  return {
    id,
    datasetId: 'convention',
    datasetVersion: '1',
    mode,
    variant: 'default',
    variantLabel: label,
    region: 'ANY',
    value: 0,
    unit: 'kgCO2e/pkm',
    gasMetric: 'CO2e',
    boundary: 'zero_direct_convention',
    sourceOrg: 'Transport GHG accounting convention',
    sourceTitle: 'Human-powered travel has no direct operational (fuel/electricity) emissions',
    sourceUrl: DESNZ_2025_URL,
    methodologyNotes:
      'Recorded as 0 kg CO2e for direct operational emissions, consistent with standard transport ' +
      'accounting. This does NOT mean the activity has zero life-cycle emissions: bicycle manufacture, ' +
      'infrastructure and additional food energy are excluded.',
    quality: 'convention',
    isRegionalProxy: false,
  };
}

// ---------------------------------------------------------------------------------------------
// UK DESNZ 2025 factors (exact values from the 2025 flat file; row IDs in sourceReference)
// ---------------------------------------------------------------------------------------------
export const DESNZ_2025_FACTORS: EmissionFactor[] = [
  zero('conv-walking-0', 'walking', 'Walking'),
  zero('conv-cycling-0', 'cycling', 'Cycling (non-electric)'),
  desnz({
    id: 'desnz25-car-average-unknown-vkm',
    mode: 'car', variant: 'average_unknown_fuel', variantLabel: 'Average car, unknown fuel',
    value: 0.16725, unit: 'kgCO2e/vkm', boundary: 'direct_operational', sourceReference: 'ID 25_301_3074_4_1',
    methodologyNotes:
      'Per vehicle-km, tailpipe (direct) emissions; excludes well-to-tank fuel production and vehicle manufacture. ' +
      'Divided by the number of occupants to obtain the user\'s share. Based on the UK car fleet.',
  }),
  desnz({
    id: 'desnz25-car-average-petrol-vkm',
    mode: 'car', variant: 'average_petrol', variantLabel: 'Average petrol car',
    value: 0.16272, unit: 'kgCO2e/vkm', boundary: 'direct_operational', sourceReference: 'ID 25_301_3070_4_1',
    methodologyNotes: 'Per vehicle-km, tailpipe (direct) emissions of an average UK petrol car. Divided by occupancy.',
  }),
  desnz({
    id: 'desnz25-car-average-bev-vkm',
    mode: 'car', variant: 'average_bev', variantLabel: 'Average battery-electric car',
    value: 0.04047, unit: 'kgCO2e/vkm', boundary: 'operational_incl_electricity', sourceReference: 'ID 25_301_3076_4_1',
    methodologyNotes:
      'Per vehicle-km, emissions from UK grid electricity generation used for charging. Taiwan\'s grid is more ' +
      'carbon-intensive than the UK grid, so this value likely UNDERSTATES a battery-electric car\'s footprint in Taiwan.',
  }),
  desnz({
    id: 'desnz25-motorbike-average-vkm',
    mode: 'motorcycle', variant: 'average', variantLabel: 'Average motorbike',
    value: 0.11367, unit: 'kgCO2e/vkm', boundary: 'direct_operational', sourceReference: 'ID 25_302_3080_4_1',
    methodologyNotes:
      'Per vehicle-km, tailpipe emissions of an average UK motorbike. Taiwan\'s fleet is dominated by small ' +
      '(≤125 cc) scooters, which typically emit less per km than the UK average; treat as an upper-range proxy.',
  }),
  desnz({
    id: 'desnz25-taxi-regular-pkm',
    mode: 'taxi', variant: 'regular', variantLabel: 'Regular taxi',
    value: 0.14861, unit: 'kgCO2e/pkm', boundary: 'direct_operational', sourceReference: 'ID 25_313_3141_11_1',
    methodologyNotes:
      'Per passenger-km using DESNZ\'s own average taxi occupancy assumption (see DESNZ methodology paper). ' +
      'Empty running between fares is not separately allocated to the passenger.',
  }),
  desnz({
    id: 'desnz25-bus-average-local-pkm',
    mode: 'bus', variant: 'average_local', variantLabel: 'Average local bus',
    value: 0.10385, unit: 'kgCO2e/pkm', boundary: 'direct_operational', sourceReference: 'ID 25_314_3145_11_1',
    methodologyNotes:
      'Per passenger-km, based on UK average bus occupancy. Bus emissions per passenger depend strongly on ' +
      'occupancy; busy urban routes in Taiwan may be lower, rural routes higher.',
  }),
  desnz({
    id: 'desnz25-bus-coach-pkm',
    mode: 'bus', variant: 'coach', variantLabel: 'Coach (long-distance)',
    value: 0.02776, unit: 'kgCO2e/pkm', boundary: 'direct_operational', sourceReference: 'ID 25_314_3146_11_1',
    methodologyNotes: 'Per passenger-km for UK long-distance coaches, which have high average load factors.',
  }),
  desnz({
    id: 'desnz25-rail-national-pkm',
    mode: 'train', variant: 'national_rail', variantLabel: 'National rail (UK average)',
    value: 0.03546, unit: 'kgCO2e/pkm', boundary: 'operational_incl_electricity', sourceReference: 'ID 25_315_3147_11_1',
    methodologyNotes: 'Per passenger-km for UK national rail, including diesel combustion and electricity generation for traction.',
  }),
  desnz({
    id: 'desnz25-rail-underground-pkm',
    mode: 'metro', variant: 'london_underground', variantLabel: 'Metro (London Underground)',
    value: 0.0278, unit: 'kgCO2e/pkm', boundary: 'operational_incl_electricity', sourceReference: 'ID 25_315_3150_11_1',
    methodologyNotes: 'Per passenger-km for the London Underground, using UK grid electricity.',
  }),
  desnz({
    id: 'desnz25-rail-lightrail-pkm',
    mode: 'metro', variant: 'light_rail_tram', variantLabel: 'Light rail and tram',
    value: 0.0286, unit: 'kgCO2e/pkm', boundary: 'operational_incl_electricity', sourceReference: 'ID 25_315_3149_11_1',
    methodologyNotes: 'Per passenger-km for UK light rail and tram systems.',
  }),
  {
    ...desnz({
      id: 'desnz25-rail-national-as-hsr-pkm',
      mode: 'hsr', variant: 'national_rail_proxy', variantLabel: 'High-speed rail (UK national rail proxy)',
      value: 0.03546, unit: 'kgCO2e/pkm', boundary: 'operational_incl_electricity', sourceReference: 'ID 25_315_3147_11_1',
      methodologyNotes:
        'DESNZ publishes no domestic high-speed-rail factor. The UK national rail factor is used as a proxy. ' +
        'The DESNZ "International rail" factor (Eurostar) is deliberately NOT used because it reflects the French grid.',
    }),
    quality: 'official_proxy_other_region',
  },
];

// ---------------------------------------------------------------------------------------------
// Taiwan official carbon-footprint label values (life-cycle product carbon footprints, per pkm)
// ---------------------------------------------------------------------------------------------
export const TW_CFP_FACTORS: EmissionFactor[] = [
  {
    id: 'twcfp-taipei-metro-2024-pkm',
    datasetId: 'tw-cfp-labels',
    datasetVersion: 'Taipei Metro label, inventory year 2024 (ROC 113)',
    mode: 'metro', variant: 'taipei_metro', variantLabel: 'Taipei Metro (MRT)',
    region: 'TW-TPE',
    value: 0.075, unit: 'kgCO2e/pkm', gasMetric: 'CO2e', boundary: 'lifecycle_product_cfp',
    sourceOrg: 'Taipei Rapid Transit Corporation (label approved under Taiwan MOENV carbon-footprint label programme)',
    sourceTitle: '旅客運輸服務碳足跡 (Passenger transport service carbon footprint)',
    sourceUrl: 'https://www.metro.taipei/cp.aspx?n=5B7ACD566D2CB1DD',
    sourceReference: 'Inventory year 2024: ~75 g CO2e/pkm (≈30 g vehicle operation + ≈45 g station services); 2023 value ≈78 g',
    publishedDate: '2025-10-17',
    effectiveFrom: '2025-10-05',
    methodologyNotes:
      'Product carbon footprint per passenger-km covering vehicle operation AND station-related service stages. ' +
      'This is a broader boundary than DESNZ operational factors. Applied to other Taiwanese metro systems ' +
      '(Kaohsiung, Taoyuan, Taichung) as a proxy; those systems have different load factors.',
    quality: 'official_primary',
    isRegionalProxy: false,
  },
  {
    id: 'twcfp-thsr-2025-pkm',
    datasetId: 'tw-cfp-labels',
    datasetVersion: 'THSR label 碳標字第2014910001-01號 (2025 renewal)',
    mode: 'hsr', variant: 'thsr', variantLabel: 'Taiwan High Speed Rail',
    region: 'TW',
    value: 0.029, unit: 'kgCO2e/pkm', gasMetric: 'CO2e', boundary: 'lifecycle_product_cfp',
    sourceOrg: 'Taiwan High Speed Rail Corporation (label approved by Taiwan MOENV, letter 環部授氣字第1149115244號)',
    sourceTitle: '環境永續－高速鐵路旅客運輸服務碳足跡',
    sourceUrl: 'https://www.thsrc.com.tw/ArticleContent/5a1f4c72-b564-4706-bcdd-efbda93c3d93',
    sourceReference: 'Certificate 碳標字第2014910001-01號, 29 g CO2e/pkm',
    publishedDate: '2025-12-09',
    effectiveFrom: '2025-12-17',
    effectiveTo: '2027-12-16',
    methodologyNotes:
      'Product carbon footprint per passenger-km covering raw-material acquisition, service and end-of-life stages ' +
      '(per THSR). Previous labels: 38 g (2014), 32 g (2020–2025).',
    quality: 'official_primary',
    isRegionalProxy: false,
  },
  {
    id: 'twcfp-tra-local-2025-pkm',
    datasetId: 'tw-cfp-labels',
    datasetVersion: 'TRA labels approved by MOENV 2025-06-25',
    mode: 'train', variant: 'tra_local', variantLabel: 'TRA Local / Local Express (區間/區間快)',
    region: 'TW',
    value: 0.055, unit: 'kgCO2e/pkm', gasMetric: 'CO2e', boundary: 'lifecycle_product_cfp',
    sourceOrg: 'Taiwan Railway Corporation (TRA); label approved by Taiwan MOENV',
    sourceTitle: 'TRA obtains carbon-footprint labels for three train classes (press coverage, 2025-08)',
    sourceUrl: 'https://www.reccessary.com/zh-tw/news/taiwan-railway-gets-carbon-footprint-label',
    sourceReference: 'Local/Local Express 55 g CO2e/pkm; also reported by Commercial Times (ctee.com.tw, 2025-08-05)',
    publishedDate: '2025-08-06',
    effectiveFrom: '2025-06-25',
    methodologyNotes:
      'Product carbon footprint per passenger-km, externally verified (verification statement 2025-03-27). ' +
      'Value verified via consistent press reports of the MOENV approval; the certificate itself was not retrieved.',
    quality: 'official_reported',
    isRegionalProxy: false,
  },
  {
    id: 'twcfp-tra-tzechiang-2025-pkm',
    datasetId: 'tw-cfp-labels',
    datasetVersion: 'TRA labels approved by MOENV 2025-06-25',
    mode: 'train', variant: 'tra_tze_chiang', variantLabel: 'TRA Tze-Chiang (自強號)',
    region: 'TW',
    value: 0.036, unit: 'kgCO2e/pkm', gasMetric: 'CO2e', boundary: 'lifecycle_product_cfp',
    sourceOrg: 'Taiwan Railway Corporation (TRA); label approved by Taiwan MOENV',
    sourceTitle: 'TRA obtains carbon-footprint labels for three train classes (press coverage, 2025-08)',
    sourceUrl: 'https://www.reccessary.com/zh-tw/news/taiwan-railway-gets-carbon-footprint-label',
    sourceReference: 'Tze-Chiang 36 g CO2e/pkm',
    publishedDate: '2025-08-06',
    effectiveFrom: '2025-06-25',
    methodologyNotes: 'Product carbon footprint per passenger-km. Verified via press reports of the MOENV approval.',
    quality: 'official_reported',
    isRegionalProxy: false,
  },
  {
    id: 'twcfp-tra-chukuang-2025-pkm',
    datasetId: 'tw-cfp-labels',
    datasetVersion: 'TRA labels approved by MOENV 2025-06-25',
    mode: 'train', variant: 'tra_chu_kuang', variantLabel: 'TRA Chu-Kuang (莒光號)',
    region: 'TW',
    value: 0.05, unit: 'kgCO2e/pkm', gasMetric: 'CO2e', boundary: 'lifecycle_product_cfp',
    sourceOrg: 'Taiwan Railway Corporation (TRA); label approved by Taiwan MOENV',
    sourceTitle: 'TRA obtains carbon-footprint labels for three train classes (press coverage, 2025-08)',
    sourceUrl: 'https://www.reccessary.com/zh-tw/news/taiwan-railway-gets-carbon-footprint-label',
    sourceReference: 'Chu-Kuang 50 g CO2e/pkm',
    publishedDate: '2025-08-06',
    effectiveFrom: '2025-06-25',
    methodologyNotes: 'Product carbon footprint per passenger-km. Verified via press reports of the MOENV approval.',
    quality: 'official_reported',
    isRegionalProxy: false,
  },
];

/** Same DESNZ value, flagged as a proxy when used inside a Taiwan-first factor set. */
function asTaiwanProxy(f: EmissionFactor): EmissionFactor {
  if (f.quality === 'convention') return f;
  return { ...f, quality: 'official_proxy_other_region', isRegionalProxy: true };
}

const desnzById = new Map(DESNZ_2025_FACTORS.map((f) => [f.id, f]));
function d(id: string): EmissionFactor {
  const f = desnzById.get(id);
  if (!f) throw new Error(`Unknown DESNZ factor ${id}`);
  return f;
}

export const FACTOR_SETS: FactorSet[] = [
  {
    id: 'ecomove-tw-hybrid',
    version: '2026.10-1',
    name: 'Taiwan-first: official Taiwan rail & MRT carbon labels + UK DESNZ 2025 road factors',
    shortName: 'Taiwan-first (mixed boundary)',
    description:
      'Uses Taiwan\'s government-approved carbon-footprint label values for MRT, TRA and THSR. Taiwan-specific ' +
      'factors for cars, motorcycles, taxis and buses could not be verified from an official source in this ' +
      'release, so UK DESNZ 2025 factors are used as clearly-labelled proxies.',
    primaryRegion: 'TW',
    defaultVariants: {
      walking: 'default', cycling: 'default', car: 'average_unknown_fuel', motorcycle: 'average', taxi: 'regular',
      bus: 'average_local', metro: 'taipei_metro', train: 'tra_local', hsr: 'thsr',
    },
    factors: [
      ...TW_CFP_FACTORS,
      d('conv-walking-0'),
      d('conv-cycling-0'),
      asTaiwanProxy(d('desnz25-car-average-unknown-vkm')),
      asTaiwanProxy(d('desnz25-car-average-petrol-vkm')),
      asTaiwanProxy(d('desnz25-car-average-bev-vkm')),
      asTaiwanProxy(d('desnz25-motorbike-average-vkm')),
      asTaiwanProxy(d('desnz25-taxi-regular-pkm')),
      asTaiwanProxy(d('desnz25-bus-average-local-pkm')),
      asTaiwanProxy(d('desnz25-bus-coach-pkm')),
    ],
    mixedBoundaries: true,
    caveats: [
      'MIXED ACCOUNTING BOUNDARIES: rail and MRT values are life-cycle product carbon footprints, while road ' +
        'values are DESNZ direct (tailpipe) factors that exclude fuel production and vehicle manufacture. ' +
        'Because the rail figures include more life-cycle stages, comparisons between rail and road in this set ' +
        'are conservative: they tend to understate, not overstate, the advantage of rail.',
      'Road factors (car, motorcycle, taxi, bus) are UK fleet averages used as proxies for Taiwan.',
      '"Other public transport" and "Unknown" trips have no factor and are reported as unavailable.',
    ],
  },
  {
    id: 'desnz-2025-uk',
    version: '2025.1',
    name: 'UK DESNZ 2025 conversion factors (single source, operational boundary)',
    shortName: 'DESNZ 2025 (consistent boundary)',
    description:
      'All factors come from one official dataset with a consistent operational boundary (direct fuel combustion ' +
      'plus electricity generation for electric traction; excludes well-to-tank and manufacturing). Best for ' +
      'like-for-like mode comparisons, but values reflect UK fleets, load factors and the UK grid.',
    primaryRegion: 'GB',
    defaultVariants: {
      walking: 'default', cycling: 'default', car: 'average_unknown_fuel', motorcycle: 'average', taxi: 'regular',
      bus: 'average_local', metro: 'london_underground', train: 'national_rail', hsr: 'national_rail_proxy',
    },
    factors: DESNZ_2025_FACTORS,
    mixedBoundaries: false,
    caveats: [
      'All values are UK averages; Taiwanese vehicles, occupancy and electricity grid differ.',
      'High-speed rail uses the UK national rail factor as a proxy.',
      '"Other public transport" and "Unknown" trips have no factor and are reported as unavailable.',
    ],
  },
];

export const DEFAULT_FACTOR_SET_ID = 'ecomove-tw-hybrid';

export function getFactorSet(id: string): FactorSet | undefined {
  return FACTOR_SETS.find((s) => s.id === id);
}

export function getFactorSetOrDefault(id: string | null | undefined): FactorSet {
  return (id && getFactorSet(id)) || (getFactorSet(DEFAULT_FACTOR_SET_ID) as FactorSet);
}

/** All distinct factors across all sets (used for the database seed). */
export function allFactors(): EmissionFactor[] {
  const byId = new Map<string, EmissionFactor>();
  for (const f of [...TW_CFP_FACTORS, ...DESNZ_2025_FACTORS]) byId.set(f.id, f);
  return [...byId.values()];
}

export function findFactor(set: FactorSet, mode: TransportMode, variant?: string | null): EmissionFactor | undefined {
  const v = variant || set.defaultVariants[mode];
  if (!v) return undefined;
  return set.factors.find((f) => f.mode === mode && f.variant === v);
}

export function variantsForMode(set: FactorSet, mode: TransportMode): EmissionFactor[] {
  return set.factors.filter((f) => f.mode === mode);
}

/**
 * Groups boundaries that can be compared without a warning. DESNZ "direct" and "incl. electricity"
 * factors follow one consistent operational convention; Taiwan life-cycle labels do not.
 */
export function boundaryGroup(b: AccountingBoundary): 'operational' | 'lifecycle' | 'neutral' {
  if (b === 'zero_direct_convention') return 'neutral';
  if (b === 'lifecycle_product_cfp') return 'lifecycle';
  return 'operational';
}

export function boundariesComparable(boundaries: Iterable<AccountingBoundary>): boolean {
  const groups = new Set<string>();
  for (const b of boundaries) {
    const g = boundaryGroup(b);
    if (g !== 'neutral') groups.add(g);
  }
  return groups.size <= 1;
}

export const BOUNDARY_LABELS: Record<AccountingBoundary, string> = {
  direct_operational: 'Direct operational (tailpipe)',
  operational_incl_electricity: 'Operational incl. electricity generation',
  lifecycle_product_cfp: 'Life-cycle product carbon footprint',
  zero_direct_convention: 'Zero direct emissions (convention)',
};

/**
 * Values found during research that could NOT be verified against an official primary source.
 * They are documented for transparency and are never used in calculations.
 */
export const UNVERIFIED_CANDIDATES = [
  {
    mode: 'car' as TransportMode,
    claimedValueKgPerPkm: 0.115,
    claimedSource: 'MOENV carbon-footprint database (2014), via a third-party compilation (infinityesg.com)',
    reason: 'Official database (cfp-calculate.tw) could not be accessed to confirm the entry, declared unit or boundary.',
  },
  {
    mode: 'motorcycle' as TransportMode,
    claimedValueKgPerPkm: 0.0951,
    claimedSource: 'MOENV carbon-footprint database (2014), via a third-party compilation',
    reason: 'Not verified against the official database.',
  },
  {
    mode: 'bus' as TransportMode,
    claimedValueKgPerPkm: 0.0767,
    claimedSource: 'MOENV carbon-footprint database (2017, "公車(甲類)"), via a third-party compilation',
    reason: 'Not verified against the official database.',
  },
  {
    mode: 'car' as TransportMode,
    claimedValueKgPerPkm: 0.104,
    claimedSource: 'Taipei City Government press release (2025-10-17), comparison figure for fuel cars',
    reason: 'The press release gives no source or methodology for this comparison value.',
  },
];
