-- EcoMove AI — initial schema
-- Trip records are authoritative; summaries are computed on demand (no cached aggregates to drift).
-- Every user-owned table has Row Level Security: users can only see and change their own rows.

-- ------------------------------------------------------------------------------------------------
-- Profiles & preferences
-- ------------------------------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  time_zone text not null default 'Asia/Taipei' check (length(time_zone) between 1 and 64),
  factor_set_id text not null default 'ecomove-tw-hybrid',
  default_car_occupancy smallint not null default 1 check (default_car_occupancy between 1 and 9),
  default_motorcycle_occupancy smallint not null default 1 check (default_motorcycle_occupancy between 1 and 2),
  max_extra_minutes smallint check (max_extra_minutes between 0 and 240),
  preferred_modes text[] not null default '{}',
  avoid_modes text[] not null default '{}',
  accessibility_notes text check (length(accessibility_notes) <= 500),
  units text not null default 'metric' check (units in ('metric')),
  notification_prefs jsonb not null default '{}'::jsonb,
  trip_retention_months smallint check (trip_retention_months between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------------------------
-- Emission factors (public reference data, read-only for clients)
-- ------------------------------------------------------------------------------------------------
create table public.emission_factors (
  id text primary key,
  dataset_id text not null,
  dataset_version text not null,
  mode text not null check (mode in ('walking','cycling','motorcycle','car','taxi','bus','metro','train','hsr','other_public','unknown')),
  variant text not null,
  variant_label text not null,
  region text not null,
  value numeric(12, 6) not null check (value >= 0),
  unit text not null check (unit in ('kgCO2e/pkm', 'kgCO2e/vkm')),
  gas_metric text not null default 'CO2e' check (gas_metric = 'CO2e'),
  boundary text not null check (boundary in ('direct_operational','operational_incl_electricity','lifecycle_product_cfp','zero_direct_convention')),
  source_org text not null,
  source_title text not null,
  source_url text not null check (source_url like 'https://%'),
  source_reference text,
  published_date date,
  effective_from date,
  effective_to date,
  methodology_notes text not null,
  quality text not null check (quality in ('official_primary','official_reported','official_proxy_other_region','convention')),
  created_at timestamptz not null default now()
);

create table public.emission_factor_sets (
  id text primary key,
  version text not null,
  name text not null,
  short_name text not null,
  description text not null,
  primary_region text not null,
  mixed_boundaries boolean not null,
  caveats text[] not null default '{}',
  default_variants jsonb not null default '{}'::jsonb
);

create table public.emission_factor_set_members (
  set_id text not null references public.emission_factor_sets (id) on delete cascade,
  factor_id text not null references public.emission_factors (id) on delete restrict,
  is_regional_proxy boolean not null default false,
  quality text not null,
  primary key (set_id, factor_id)
);

-- ------------------------------------------------------------------------------------------------
-- Trips
-- ------------------------------------------------------------------------------------------------
create table public.trips (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  distance_km double precision not null check (distance_km >= 0 and distance_km <= 1500),
  mode text not null check (mode in ('walking','cycling','motorcycle','car','taxi','bus','metro','train','hsr','other_public','unknown')),
  proposed_mode text check (proposed_mode in ('walking','cycling','motorcycle','car','taxi','bus','metro','train','hsr','other_public','unknown')),
  variant text check (length(variant) <= 40),
  occupancy smallint check (occupancy between 1 and 9),
  origin_label text check (length(origin_label) <= 120),
  origin_lat double precision check (origin_lat between -90 and 90),
  origin_lng double precision check (origin_lng between -180 and 180),
  destination_label text check (length(destination_label) <= 120),
  destination_lat double precision check (destination_lat between -90 and 90),
  destination_lng double precision check (destination_lng between -180 and 180),
  detection_source text not null check (detection_source in ('manual', 'auto')),
  classification_confidence real check (classification_confidence between 0 and 1),
  confirmation_status text not null check (confirmation_status in ('confirmed','needs_review','edited','dismissed')),
  dedupe_key text check (length(dedupe_key) <= 64),
  notes text check (length(notes) <= 500),
  -- calculation snapshot (keeps historical reports reproducible)
  calc_status text not null check (calc_status in ('calculated','factor_unavailable','invalid_input')),
  emissions_kg double precision check (emissions_kg >= 0),
  factor_id text references public.emission_factors (id) on delete restrict,
  factor_value double precision,
  factor_unit text check (factor_unit in ('kgCO2e/pkm', 'kgCO2e/vkm')),
  factor_set_id text not null,
  factor_set_version text not null,
  boundary text,
  calc_method text not null,
  calc_engine_version text not null,
  occupancy_applied smallint,
  calculated_at timestamptz not null,
  -- client timestamps (last-write-wins conflict resolution) and server receive time (sync cursor)
  created_at timestamptz not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  constraint trips_time_order check (ended_at >= started_at),
  constraint trips_max_duration check (ended_at - started_at <= interval '24 hours'),
  constraint trips_calc_consistency check (
    (calc_status = 'calculated' and emissions_kg is not null and factor_id is not null)
    or (calc_status <> 'calculated' and emissions_kg is null)
  )
);

create index trips_user_started_idx on public.trips (user_id, started_at desc);
create index trips_user_sync_idx on public.trips (user_id, server_updated_at);
create unique index trips_user_dedupe_key_idx on public.trips (user_id, dedupe_key) where dedupe_key is not null;

-- Minimal deletion markers so other devices learn about deletions. Contain no trip content.
create table public.trip_tombstones (
  trip_id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deleted_at timestamptz not null,
  server_updated_at timestamptz not null default now()
);
create index trip_tombstones_user_sync_idx on public.trip_tombstones (user_id, server_updated_at);

-- ------------------------------------------------------------------------------------------------
-- Goals
-- ------------------------------------------------------------------------------------------------
create table public.goals (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('reduce_emissions_pct','max_taxi_trips','max_short_motorised_trips','min_public_transport_trips','min_active_trips')),
  target_value numeric(8, 2) not null check (target_value >= 0),
  period text not null check (period in ('week', 'month')),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index goals_user_idx on public.goals (user_id, server_updated_at);

-- ------------------------------------------------------------------------------------------------
-- Agent execution metadata (no prompts, replies or locations are stored)
-- ------------------------------------------------------------------------------------------------
create table public.agent_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  provider text not null,
  model text not null,
  status text not null,
  steps smallint not null,
  tools jsonb not null default '[]'::jsonb,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer
);
create index agent_runs_user_created_idx on public.agent_runs (user_id, created_at desc);

-- ------------------------------------------------------------------------------------------------
-- Triggers
-- ------------------------------------------------------------------------------------------------
create or replace function public.touch_server_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

create trigger trips_touch before insert or update on public.trips
  for each row execute function public.touch_server_updated_at();
create trigger goals_touch before insert or update on public.goals
  for each row execute function public.touch_server_updated_at();
create trigger tombstones_touch before insert or update on public.trip_tombstones
  for each row execute function public.touch_server_updated_at();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Create a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_tombstones enable row level security;
alter table public.goals enable row level security;
alter table public.agent_runs enable row level security;
alter table public.emission_factors enable row level security;
alter table public.emission_factor_sets enable row level security;
alter table public.emission_factor_set_members enable row level security;

create policy "profiles: owner read" on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "profiles: owner insert" on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "profiles: owner update" on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "trips: owner read" on public.trips for select to authenticated using (user_id = (select auth.uid()));
create policy "trips: owner insert" on public.trips for insert to authenticated with check (user_id = (select auth.uid()));
create policy "trips: owner update" on public.trips for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "trips: owner delete" on public.trips for delete to authenticated using (user_id = (select auth.uid()));

create policy "tombstones: owner read" on public.trip_tombstones for select to authenticated using (user_id = (select auth.uid()));
create policy "tombstones: owner insert" on public.trip_tombstones for insert to authenticated with check (user_id = (select auth.uid()));
create policy "tombstones: owner update" on public.trip_tombstones for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "tombstones: owner delete" on public.trip_tombstones for delete to authenticated using (user_id = (select auth.uid()));

create policy "goals: owner read" on public.goals for select to authenticated using (user_id = (select auth.uid()));
create policy "goals: owner insert" on public.goals for insert to authenticated with check (user_id = (select auth.uid()));
create policy "goals: owner update" on public.goals for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "goals: owner delete" on public.goals for delete to authenticated using (user_id = (select auth.uid()));

-- Agent metadata: users may read and append their own rows; no update/delete (keeps rate limiting honest).
create policy "agent_runs: owner read" on public.agent_runs for select to authenticated using (user_id = (select auth.uid()));
create policy "agent_runs: owner insert" on public.agent_runs for insert to authenticated with check (user_id = (select auth.uid()));

-- Reference data: readable by everyone, writable only by migrations / service role.
create policy "factors: public read" on public.emission_factors for select to anon, authenticated using (true);
create policy "factor sets: public read" on public.emission_factor_sets for select to anon, authenticated using (true);
create policy "factor set members: public read" on public.emission_factor_set_members for select to anon, authenticated using (true);

-- Explicit privileges (do not rely on platform defaults).
revoke all on public.profiles, public.trips, public.trip_tombstones, public.goals, public.agent_runs from anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.trips to authenticated;
grant select, insert, update, delete on public.trip_tombstones to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
grant select, insert on public.agent_runs to authenticated;
revoke insert, update, delete on public.emission_factors, public.emission_factor_sets, public.emission_factor_set_members from anon, authenticated;
grant select on public.emission_factors, public.emission_factor_sets, public.emission_factor_set_members to anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- Sync RPCs (SECURITY INVOKER: RLS applies to everything they touch)
-- ------------------------------------------------------------------------------------------------

-- Upserts trips with last-write-wins on the client `updated_at`; deletions arrive with `deleted_at`.
-- Retrying the same payload is idempotent (primary key = client-generated UUID).
create or replace function public.sync_push_trips(p_trips jsonb)
returns table (trip_id uuid, applied boolean)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  r jsonb;
  v_id uuid;
  v_updated timestamptz;
  v_count integer;
begin
  if jsonb_typeof(p_trips) <> 'array' or jsonb_array_length(p_trips) > 500 then
    raise exception 'p_trips must be an array of at most 500 trips';
  end if;
  for r in select * from jsonb_array_elements(p_trips) loop
    v_id := (r->>'id')::uuid;
    v_updated := (r->>'updated_at')::timestamptz;
    if r ? 'deleted_at' and r->>'deleted_at' is not null then
      delete from public.trips t where t.id = v_id and t.updated_at <= v_updated;
      insert into public.trip_tombstones as tt (trip_id, deleted_at) values (v_id, (r->>'deleted_at')::timestamptz)
        on conflict (trip_id) do update set deleted_at = excluded.deleted_at
        where tt.user_id = (select auth.uid());
      trip_id := v_id; applied := true; return next;
      continue;
    end if;
    -- A tombstone newer than this edit wins.
    if exists (select 1 from public.trip_tombstones tt where tt.trip_id = v_id and tt.deleted_at >= v_updated) then
      trip_id := v_id; applied := false; return next;
      continue;
    end if;
    begin
    insert into public.trips as t (
      id, started_at, ended_at, distance_km, mode, proposed_mode, variant, occupancy,
      origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng,
      detection_source, classification_confidence, confirmation_status, dedupe_key, notes,
      calc_status, emissions_kg, factor_id, factor_value, factor_unit, factor_set_id, factor_set_version,
      boundary, calc_method, calc_engine_version, occupancy_applied, calculated_at, created_at, updated_at
    ) values (
      v_id, (r->>'started_at')::timestamptz, (r->>'ended_at')::timestamptz, (r->>'distance_km')::double precision,
      r->>'mode', r->>'proposed_mode', r->>'variant', (r->>'occupancy')::smallint,
      r->>'origin_label', (r->>'origin_lat')::double precision, (r->>'origin_lng')::double precision,
      r->>'destination_label', (r->>'destination_lat')::double precision, (r->>'destination_lng')::double precision,
      r->>'detection_source', (r->>'classification_confidence')::real, r->>'confirmation_status', r->>'dedupe_key', r->>'notes',
      r->>'calc_status', (r->>'emissions_kg')::double precision, r->>'factor_id', (r->>'factor_value')::double precision,
      r->>'factor_unit', r->>'factor_set_id', r->>'factor_set_version', r->>'boundary', r->>'calc_method',
      r->>'calc_engine_version', (r->>'occupancy_applied')::smallint, (r->>'calculated_at')::timestamptz,
      (r->>'created_at')::timestamptz, v_updated
    )
    on conflict (id) do update set
      started_at = excluded.started_at, ended_at = excluded.ended_at, distance_km = excluded.distance_km,
      mode = excluded.mode, proposed_mode = excluded.proposed_mode, variant = excluded.variant, occupancy = excluded.occupancy,
      origin_label = excluded.origin_label, origin_lat = excluded.origin_lat, origin_lng = excluded.origin_lng,
      destination_label = excluded.destination_label, destination_lat = excluded.destination_lat, destination_lng = excluded.destination_lng,
      classification_confidence = excluded.classification_confidence, confirmation_status = excluded.confirmation_status,
      notes = excluded.notes, calc_status = excluded.calc_status, emissions_kg = excluded.emissions_kg,
      factor_id = excluded.factor_id, factor_value = excluded.factor_value, factor_unit = excluded.factor_unit,
      factor_set_id = excluded.factor_set_id, factor_set_version = excluded.factor_set_version, boundary = excluded.boundary,
      calc_method = excluded.calc_method, calc_engine_version = excluded.calc_engine_version,
      occupancy_applied = excluded.occupancy_applied, calculated_at = excluded.calculated_at, updated_at = excluded.updated_at
    where t.updated_at <= excluded.updated_at;
    get diagnostics v_count = row_count;
    exception when unique_violation then
      -- Same dedupe_key already stored for this user (duplicate automatic detection): skip this row only.
      v_count := 0;
    end;
    trip_id := v_id; applied := v_count > 0; return next;
  end loop;
end;
$$;

revoke execute on function public.sync_push_trips(jsonb) from public, anon;
grant execute on function public.sync_push_trips(jsonb) to authenticated;

-- Deletes all of the caller's mobility data but keeps the account (RLS-scoped).
create or replace function public.delete_my_data()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.trips where user_id = (select auth.uid());
  delete from public.trip_tombstones where user_id = (select auth.uid());
  delete from public.goals where user_id = (select auth.uid());
end;
$$;
revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
