-- =============================================================================
-- THE ENJOYE Beauty OS — Phase 3B Database Foundation
-- Migration: 20260918120000_beauty_os_foundation.sql
--
-- Safe to run on an empty Supabase project.
-- Does NOT modify auth.users / storage.objects / system schemas.
-- Does NOT seed demo customer data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.staff_role as enum (
    'OWNER',
    'MANAGER',
    'THERAPIST',
    'RECEPTIONIST'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.customer_status as enum (
    'ACTIVE',
    'INACTIVE',
    'ARCHIVED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.service_type as enum (
    'BREAST',
    'BODY_SCULPTING',
    'FACIAL',
    'WOMB_CARE',
    'DETOX',
    'NAVEL_CANDLE',
    'EXFOLIATION',
    'WAXING',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.appointment_status as enum (
    'BOOKED',
    'CONFIRMED',
    'ARRIVED',
    'IN_SERVICE',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.treatment_mode as enum (
    'STANDARD',
    'QUICK'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.treatment_status as enum (
    'DRAFT',
    'COMPLETED',
    'VOID'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.treatment_photo_type as enum (
    'BEFORE',
    'AFTER',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles (id will map to auth.users.id when Auth is introduced)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id),
  full_name text not null,
  display_name text,
  phone text,
  avatar_url text,
  role public.staff_role not null default 'THERAPIST',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  customer_number text,
  full_name text not null,
  preferred_name text,
  phone text,
  email text,
  birthday date,
  gender text,
  line_user_id text,
  source text,
  first_visit_date date,
  last_visit_date date,
  visit_count integer not null default 0,
  is_vip boolean not null default false,
  status public.customer_status not null default 'ACTIVE',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_visit_count_nonnegative check (visit_count >= 0)
);

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- customer_consultations (long-lived questionnaire / consent profile)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_consultations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  organization_id uuid not null references public.organizations (id),
  consultation_data jsonb not null default '{}'::jsonb,
  allergies text,
  important_notes text,
  consent_confirmed boolean not null default false,
  consent_confirmed_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_customer_consultations_updated_at on public.customer_consultations;
create trigger trg_customer_consultations_updated_at
before update on public.customer_consultations
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null,
  service_type public.service_type not null,
  duration_minutes integer not null,
  price numeric(10, 2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_duration_positive check (duration_minutes > 0)
);

drop trigger if exists trg_services_updated_at on public.services;
create trigger trg_services_updated_at
before update on public.services
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  customer_id uuid not null references public.customers (id),
  service_id uuid not null references public.services (id),
  staff_id uuid references public.profiles (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'BOOKED',
  customer_note text,
  internal_note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_time_range check (ends_at > starts_at)
);

drop trigger if exists trg_appointments_updated_at on public.appointments;
create trigger trg_appointments_updated_at
before update on public.appointments
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- treatments (session records; flexible JSONB payloads for Phase 3B)
-- ---------------------------------------------------------------------------
create table if not exists public.treatments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  appointment_id uuid references public.appointments (id),
  customer_id uuid not null references public.customers (id),
  service_id uuid not null references public.services (id),
  staff_id uuid references public.profiles (id),
  mode public.treatment_mode not null default 'STANDARD',
  template_type public.service_type not null,
  assessment jsonb not null default '{}'::jsonb,
  body_markers jsonb not null default '[]'::jsonb,
  operations jsonb not null default '[]'::jsonb,
  products jsonb not null default '[]'::jsonb,
  professional_note text,
  client_feeling text,
  follow_up jsonb not null default '{}'::jsonb,
  skipped_steps jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  status public.treatment_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_treatments_updated_at on public.treatments;
create trigger trg_treatments_updated_at
before update on public.treatments
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- treatment_photos (metadata only — no Storage bucket in Phase 3B)
-- ---------------------------------------------------------------------------
create table if not exists public.treatment_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  treatment_id uuid not null references public.treatments (id) on delete cascade,
  customer_id uuid not null references public.customers (id),
  photo_type public.treatment_photo_type not null,
  storage_path text not null,
  sort_order integer not null default 0,
  taken_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint treatment_photos_sort_order_nonnegative check (sort_order >= 0)
);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_customers_org_full_name
  on public.customers (organization_id, full_name);

create index if not exists idx_customers_org_phone
  on public.customers (organization_id, phone);

create index if not exists idx_appointments_org_starts_at
  on public.appointments (organization_id, starts_at);

create index if not exists idx_appointments_customer_starts_at
  on public.appointments (customer_id, starts_at desc);

create index if not exists idx_appointments_staff_starts_at
  on public.appointments (staff_id, starts_at);

create index if not exists idx_treatments_customer_created_at
  on public.treatments (customer_id, created_at desc);

create index if not exists idx_treatments_appointment_id
  on public.treatments (appointment_id);

create index if not exists idx_treatment_photos_treatment_id
  on public.treatment_photos (treatment_id);

create index if not exists idx_services_org_is_active
  on public.services (organization_id, is_active);

create index if not exists idx_profiles_organization_id
  on public.profiles (organization_id);

create index if not exists idx_customer_consultations_customer_id
  on public.customer_consultations (customer_id);

create index if not exists idx_audit_logs_org_created_at
  on public.audit_logs (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS helpers (fixed search_path; security definer to avoid recursive RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

revoke all on function public.current_organization_id() from public;
revoke all on function public.current_staff_role() from public;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.current_staff_role() to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS on all business tables
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.customer_consultations enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.treatments enable row level security;
alter table public.treatment_photos enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Policies: organization isolation for authenticated staff
-- No anon policies on customer / treatment / appointment data.
-- ---------------------------------------------------------------------------

-- organizations: read own org only (writes via service role / dashboard)
drop policy if exists organizations_select_own on public.organizations;
create policy organizations_select_own
  on public.organizations
  for select
  to authenticated
  using (id = public.current_organization_id());

-- profiles: read own row (bootstrap) or same organization
drop policy if exists profiles_select_own_or_org on public.profiles;
create policy profiles_select_own_or_org
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or organization_id = public.current_organization_id()
  );

-- No authenticated INSERT/UPDATE/DELETE on profiles in Phase 3B
-- (role / org assignment handled later via server/admin flows)

-- customers
drop policy if exists customers_select_org on public.customers;
create policy customers_select_org
  on public.customers for select to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists customers_insert_org on public.customers;
create policy customers_insert_org
  on public.customers for insert to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists customers_update_org on public.customers;
create policy customers_update_org
  on public.customers for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists customers_delete_org on public.customers;
create policy customers_delete_org
  on public.customers for delete to authenticated
  using (organization_id = public.current_organization_id());

-- customer_consultations
drop policy if exists customer_consultations_select_org on public.customer_consultations;
create policy customer_consultations_select_org
  on public.customer_consultations for select to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists customer_consultations_insert_org on public.customer_consultations;
create policy customer_consultations_insert_org
  on public.customer_consultations for insert to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists customer_consultations_update_org on public.customer_consultations;
create policy customer_consultations_update_org
  on public.customer_consultations for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists customer_consultations_delete_org on public.customer_consultations;
create policy customer_consultations_delete_org
  on public.customer_consultations for delete to authenticated
  using (organization_id = public.current_organization_id());

-- services
drop policy if exists services_select_org on public.services;
create policy services_select_org
  on public.services for select to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists services_insert_org on public.services;
create policy services_insert_org
  on public.services for insert to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists services_update_org on public.services;
create policy services_update_org
  on public.services for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists services_delete_org on public.services;
create policy services_delete_org
  on public.services for delete to authenticated
  using (organization_id = public.current_organization_id());

-- appointments
drop policy if exists appointments_select_org on public.appointments;
create policy appointments_select_org
  on public.appointments for select to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists appointments_insert_org on public.appointments;
create policy appointments_insert_org
  on public.appointments for insert to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists appointments_update_org on public.appointments;
create policy appointments_update_org
  on public.appointments for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists appointments_delete_org on public.appointments;
create policy appointments_delete_org
  on public.appointments for delete to authenticated
  using (organization_id = public.current_organization_id());

-- treatments
drop policy if exists treatments_select_org on public.treatments;
create policy treatments_select_org
  on public.treatments for select to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists treatments_insert_org on public.treatments;
create policy treatments_insert_org
  on public.treatments for insert to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists treatments_update_org on public.treatments;
create policy treatments_update_org
  on public.treatments for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists treatments_delete_org on public.treatments;
create policy treatments_delete_org
  on public.treatments for delete to authenticated
  using (organization_id = public.current_organization_id());

-- treatment_photos
drop policy if exists treatment_photos_select_org on public.treatment_photos;
create policy treatment_photos_select_org
  on public.treatment_photos for select to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists treatment_photos_insert_org on public.treatment_photos;
create policy treatment_photos_insert_org
  on public.treatment_photos for insert to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists treatment_photos_update_org on public.treatment_photos;
create policy treatment_photos_update_org
  on public.treatment_photos for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists treatment_photos_delete_org on public.treatment_photos;
create policy treatment_photos_delete_org
  on public.treatment_photos for delete to authenticated
  using (organization_id = public.current_organization_id());

-- audit_logs: insert own org; select OWNER/MANAGER only; no update/delete
drop policy if exists audit_logs_insert_org on public.audit_logs;
create policy audit_logs_insert_org
  on public.audit_logs
  for insert
  to authenticated
  with check (
    organization_id = public.current_organization_id()
    and (actor_id is null or actor_id = auth.uid())
  );

drop policy if exists audit_logs_select_managers on public.audit_logs;
create policy audit_logs_select_managers
  on public.audit_logs
  for select
  to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_staff_role() in ('OWNER', 'MANAGER')
  );
