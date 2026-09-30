-- =============================================================================
-- Beauty OS — Canonical Staff Auth membership (Strategy B)
-- Migration: 20260928112950_staff_auth_memberships.sql
--
-- Runs after enum adapt (112900) and before operational foundation (113000).
-- Empty-project order:
--   foundation → enum adapt → identity / membership (this file) → operational
--
-- Canonical mapping:
--   auth.users.id
--     → staff_auth_memberships.auth_user_id
--     → staff_auth_memberships.user_id (staff-001 / staff-*)
--     → Appointment / Treatment / Schedule / Checkout / Transaction staff refs
--
-- Does NOT:
--   create public.staff_memberships (Strategy A: user_id → profiles.id)
--   rewrite checkpointed 20260918120000_beauty_os_foundation.sql
--   store passwords
--   create Employee / StaffProfile tables
--   treat auth.users.id as operational staffId
--
-- organization_id / user_id / location_id are Beauty OS operational text ids
-- (org-the-enjoye, staff-001, loc-enjoye-main). organizations.id is UUID;
-- app_id is added in 113000, so this table cannot FK to organizations.id.
-- =============================================================================

create or replace function public.is_auth_uuid(value text)
returns boolean
language sql
immutable
as $$
  select value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$$;

create or replace function public.is_operational_staff_id(value text)
returns boolean
language sql
immutable
as $$
  select value is not null
    and length(btrim(value)) > 0
    and not public.is_auth_uuid(value);
$$;

comment on function public.is_operational_staff_id(text) is
  'True when value is a Beauty OS operational staff-* id, never an auth UUID.';

create table if not exists public.staff_auth_memberships (
  id text primary key,
  user_id text not null,
  auth_user_id uuid references auth.users (id) on delete set null,
  organization_id text not null,
  role text not null,
  display_name text not null,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_auth_memberships_role_check
    check (role in ('OWNER', 'MANAGER', 'STAFF', 'RECEPTIONIST', 'ACCOUNTANT')),
  constraint staff_auth_memberships_user_id_not_uuid
    check (public.is_operational_staff_id(user_id)),
  constraint staff_auth_memberships_org_user_unique
    unique (organization_id, user_id)
);

comment on table public.staff_auth_memberships is
  'Canonical Strategy B login mapping. user_id is operational staff-*; auth_user_id is auth.users.id. Password is never stored here. Do not create a second membership table.';

create unique index if not exists staff_auth_memberships_auth_org_unique
  on public.staff_auth_memberships (auth_user_id, organization_id)
  where auth_user_id is not null;

create index if not exists staff_auth_memberships_auth_user_id_idx
  on public.staff_auth_memberships (auth_user_id);

create index if not exists staff_auth_memberships_organization_id_idx
  on public.staff_auth_memberships (organization_id);

drop trigger if exists trg_staff_auth_memberships_updated_at on public.staff_auth_memberships;
create trigger trg_staff_auth_memberships_updated_at
before update on public.staff_auth_memberships
for each row execute function public.set_updated_at();

-- Location assignment. Empty set = all org locations (same as current app).
-- No FK to public.locations: that table is created in 113000.
create table if not exists public.staff_auth_membership_locations (
  membership_id text not null references public.staff_auth_memberships (id) on delete cascade,
  location_id text not null,
  primary key (membership_id, location_id)
);

comment on table public.staff_auth_membership_locations is
  'Canonical location assignment for a staff_auth_memberships row. Do not also store location_ids[] on the parent.';

-- ---------------------------------------------------------------------------
-- RLS — honest, fail-closed writes
--
-- Limitation: this table keys organization_id as operational text. Isolation
-- against organizations.id (uuid) is completed in 113000 via
-- user_has_org_membership(), which joins organizations.app_id.
--
-- Authenticated clients may read only their own mapped rows here.
-- 113000 adds org-colleague SELECT after app_id exists.
-- All inserts/updates (including OWNER create, role change, activate)
-- go through the service role on the server. No write policies on purpose.
-- Role cannot be client-elevated.
-- ---------------------------------------------------------------------------
alter table public.staff_auth_memberships enable row level security;
alter table public.staff_auth_membership_locations enable row level security;

revoke all on public.staff_auth_memberships from anon, authenticated, public;
revoke all on public.staff_auth_membership_locations from anon, authenticated, public;

grant select on public.staff_auth_memberships to authenticated;
grant select on public.staff_auth_membership_locations to authenticated;

drop policy if exists staff_auth_memberships_select_own on public.staff_auth_memberships;
create policy staff_auth_memberships_select_own
on public.staff_auth_memberships
for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists staff_auth_membership_locations_select_own
  on public.staff_auth_membership_locations;
create policy staff_auth_membership_locations_select_own
on public.staff_auth_membership_locations
for select
to authenticated
using (
  exists (
    select 1
    from public.staff_auth_memberships m
    where m.id = membership_id
      and m.auth_user_id = auth.uid()
  )
);
