/**
 * Generates the SQL seed for emission factors from the TypeScript dataset, so that the database and the
 * app always use identical values. Regenerate with `npm run gen:factor-seed`; a test fails if the committed
 * migration is out of date.
 */
import { allFactors, FACTOR_SETS } from './factors.ts';

function lit(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${v.replace(/'/g, "''")}'`;
}

function textArray(values: string[]): string {
  return `array[${values.map(lit).join(', ')}]::text[]`;
}

export function buildFactorSeedSql(): string {
  const lines: string[] = [
    '-- GENERATED FILE — do not edit by hand. Source: supabase/functions/_shared/core/factors.ts',
    '-- Regenerate with: npm run gen:factor-seed',
    '',
  ];
  for (const f of allFactors()) {
    lines.push(
      'insert into public.emission_factors (id, dataset_id, dataset_version, mode, variant, variant_label, region, value, unit, gas_metric, boundary, source_org, source_title, source_url, source_reference, published_date, effective_from, effective_to, methodology_notes, quality) values (' +
        [f.id, f.datasetId, f.datasetVersion, f.mode, f.variant, f.variantLabel, f.region, f.value, f.unit, f.gasMetric, f.boundary, f.sourceOrg, f.sourceTitle, f.sourceUrl, f.sourceReference, f.publishedDate, f.effectiveFrom, f.effectiveTo, f.methodologyNotes, f.quality]
          .map(lit)
          .join(', ') +
        ') on conflict (id) do nothing;',
    );
  }
  lines.push('');
  for (const s of FACTOR_SETS) {
    lines.push(
      'insert into public.emission_factor_sets (id, version, name, short_name, description, primary_region, mixed_boundaries, caveats, default_variants) values (' +
        [lit(s.id), lit(s.version), lit(s.name), lit(s.shortName), lit(s.description), lit(s.primaryRegion), lit(s.mixedBoundaries), textArray(s.caveats), `${lit(JSON.stringify(s.defaultVariants))}::jsonb`].join(', ') +
        ') on conflict (id) do update set version = excluded.version, name = excluded.name, short_name = excluded.short_name, description = excluded.description, mixed_boundaries = excluded.mixed_boundaries, caveats = excluded.caveats, default_variants = excluded.default_variants;',
    );
    for (const f of s.factors) {
      lines.push(
        `insert into public.emission_factor_set_members (set_id, factor_id, is_regional_proxy, quality) values (${lit(s.id)}, ${lit(f.id)}, ${lit(f.isRegionalProxy)}, ${lit(f.quality)}) on conflict (set_id, factor_id) do update set is_regional_proxy = excluded.is_regional_proxy, quality = excluded.quality;`,
      );
    }
  }
  return lines.join('\n') + '\n';
}
