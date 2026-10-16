// Run with: npm run gen:factor-seed   (Node ≥ 22.18 strips TypeScript types natively)
import { writeFileSync } from 'node:fs';
import { buildFactorSeedSql } from '../supabase/functions/_shared/core/factorSeed.ts';

const target = new URL('../supabase/migrations/20261010000100_seed_emission_factors.sql', import.meta.url);
writeFileSync(target, buildFactorSeedSql(), 'utf8');
console.log(`Wrote ${target.pathname}`);
