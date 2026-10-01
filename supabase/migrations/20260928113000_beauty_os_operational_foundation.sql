-- =============================================================================
-- Beauty OS — Phase 5A-1 Operational Persistence Foundation
-- Migration: 20260928113000_beauty_os_operational_foundation.sql
--
-- Additive only. Does NOT:
--   DROP / TRUNCATE / DELETE data
--   rewrite 20260918120000_beauty_os_foundation.sql
--   store derived package remaining or stored-value balance
--   enable app runtime (stores remain localStorage until Phase 5A-2)
--   create public.staff_memberships (Strategy A). Canonical membership is
--     public.staff_auth_memberships from 20260928112950.
--
-- Strategy B: operational staff columns store staff-* text, never auth UUID.
-- Checkpointed foundation created uuid FKs to profiles; this unapplied draft
-- converts those columns in-place so an empty Supabase can apply Strategy B
-- without a correction migration.
--
-- Money: integer minor units (bigint). Currency text; not hard-coded to TWD.
-- Package / stored-value balances: SUM(ledger) only. Never a balance column.
-- =============================================================================

-- Enum ADAPT values live in 20260928112900_beauty_os_enum_adapt.sql
-- Identity / membership lives in 20260928112950_staff_auth_memberships.sql
-- (must be prior migrations so STAFF / DRAFT / staff_auth_memberships exist).

do $$ begin
  create type public.organization_status as enum (
    'ACTIVE', 'TRIAL', 'SUSPENDED', 'ARCHIVED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.checkout_draft_status as enum (
    'OPEN', 'READY', 'COMPLETED', 'VOIDED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.checkout_item_type as enum (
    'SERVICE', 'PRODUCT', 'CUSTOM', 'PACKAGE_PURCHASE', 'STORED_VALUE_TOP_UP'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.discount_type as enum (
    'ORDER_FIXED', 'ORDER_PERCENTAGE'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_method as enum (
    'CASH', 'CARD', 'TRANSFER', 'OTHER', 'STORED_VALUE', 'PACKAGE'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.transaction_status as enum (
    'COMPLETED', 'VOIDED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.customer_package_status as enum (
    'ACTIVE', 'EXHAUSTED', 'EXPIRED', 'VOIDED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.package_ledger_type as enum (
    'PURCHASE', 'REDEMPTION', 'ADJUSTMENT', 'REVERSAL'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.stored_value_account_status as enum (
    'ACTIVE', 'SUSPENDED', 'CLOSED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.stored_value_ledger_type as enum (
    'TOP_UP', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.inventory_movement_type as enum (
    'RECEIVE', 'SALE', 'ADJUSTMENT', 'REVERSAL'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.follow_up_task_status as enum (
    'OPEN', 'COMPLETED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.follow_up_task_type as enum (
    'TREATMENT_FOLLOW_UP', 'REBOOKING'
  );
exception when duplicate_object then null;
end $$;

-- Ledger / snapshot immutability (append-only)
create or replace function public.reject_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ledger and settlement snapshots are append-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- organizations ADAPT (keep id uuid; add SaaS columns from app Organization)
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists slug text,
  add column if not exists app_id text,
  add column if not exists logo_url text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists timezone text not null default 'Asia/Taipei',
  add column if not exists currency text not null default 'TWD',
  add column if not exists locale text not null default 'zh-TW',
  add column if not exists status public.organization_status not null default 'ACTIVE';

create unique index if not exists idx_organizations_slug
  on public.organizations (slug)
  where slug is not null;

create unique index if not exists idx_organizations_app_id
  on public.organizations (app_id)
  where app_id is not null;

-- ---------------------------------------------------------------------------
-- locations (new)
-- ---------------------------------------------------------------------------
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  app_id text,
  name text not null,
  code text,
  phone text,
  address text,
  timezone text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_locations_updated_at on public.locations;
create trigger trg_locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

create unique index if not exists idx_locations_org_app_id
  on public.locations (organization_id, app_id)
  where app_id is not null;

create index if not exists idx_locations_organization_id
  on public.locations (organization_id);

-- ---------------------------------------------------------------------------
-- Canonical membership is public.staff_auth_memberships (20260928112950).
-- Do not create public.staff_memberships (Strategy A: user_id = profiles.id).
-- Empty staff_auth_membership_locations = all org locations
-- (matches current app locationIds []).
--
-- Convert checkpointed foundation operational staff columns from
-- uuid → profiles.id to text staff-*. Empty DB: USING staff_id::text is safe.
-- profiles.id remains auth.users.id (auth profile metadata only).
--
-- Postgres cannot ALTER COLUMN TYPE while a policy expression depends on it.
-- Foundation audit_logs_insert_org still compared the actor column to the
-- Auth UUID (Strategy A). Drop that coupling before conversion. Do not
-- recast the actor column to keep Auth UUID equality — recreate Strategy B
-- policies after user_has_org_membership exists: actor_id must equal the
-- caller's staff_auth_memberships.user_id (staff-*), never auth.users.id.
-- ---------------------------------------------------------------------------
drop policy if exists audit_logs_insert_org on public.audit_logs;
drop policy if exists audit_logs_select_managers on public.audit_logs;

alter table public.appointments drop constraint if exists appointments_staff_id_fkey;
alter table public.appointments drop constraint if exists appointments_created_by_fkey;
alter table public.treatments drop constraint if exists treatments_staff_id_fkey;
alter table public.customer_consultations drop constraint if exists customer_consultations_created_by_fkey;
alter table public.customer_consultations drop constraint if exists customer_consultations_updated_by_fkey;
alter table public.treatment_photos drop constraint if exists treatment_photos_created_by_fkey;
alter table public.audit_logs drop constraint if exists audit_logs_actor_id_fkey;

alter table public.appointments
  alter column staff_id type text using staff_id::text;
alter table public.appointments
  alter column created_by type text using created_by::text;
alter table public.treatments
  alter column staff_id type text using staff_id::text;
alter table public.customer_consultations
  alter column created_by type text using created_by::text;
alter table public.customer_consultations
  alter column updated_by type text using updated_by::text;
alter table public.treatment_photos
  alter column created_by type text using created_by::text;
alter table public.audit_logs
  alter column actor_id type text using actor_id::text;

alter table public.appointments drop constraint if exists appointments_staff_id_operational;
alter table public.appointments
  add constraint appointments_staff_id_operational
  check (staff_id is null or public.is_operational_staff_id(staff_id));
alter table public.appointments drop constraint if exists appointments_created_by_operational;
alter table public.appointments
  add constraint appointments_created_by_operational
  check (created_by is null or public.is_operational_staff_id(created_by));
alter table public.treatments drop constraint if exists treatments_staff_id_operational;
alter table public.treatments
  add constraint treatments_staff_id_operational
  check (staff_id is null or public.is_operational_staff_id(staff_id));
alter table public.customer_consultations drop constraint if exists customer_consultations_created_by_operational;
alter table public.customer_consultations
  add constraint customer_consultations_created_by_operational
  check (created_by is null or public.is_operational_staff_id(created_by));
alter table public.customer_consultations drop constraint if exists customer_consultations_updated_by_operational;
alter table public.customer_consultations
  add constraint customer_consultations_updated_by_operational
  check (updated_by is null or public.is_operational_staff_id(updated_by));
alter table public.treatment_photos drop constraint if exists treatment_photos_created_by_operational;
alter table public.treatment_photos
  add constraint treatment_photos_created_by_operational
  check (created_by is null or public.is_operational_staff_id(created_by));
alter table public.audit_logs drop constraint if exists audit_logs_actor_id_operational;
alter table public.audit_logs
  add constraint audit_logs_actor_id_operational
  check (actor_id is null or public.is_operational_staff_id(actor_id));

-- Membership helpers. Never trust client organization_id.
-- auth.uid() → staff_auth_memberships.auth_user_id → organizations.app_id.
-- THERAPIST is treated as STAFF-level (Phase 3B enum ADAPT, not a second role system).
--
-- Limitation: JWT has no request-scoped current organization. Isolation is
-- "any organization with an active membership", not a single current org.
-- organizations.app_id must be set or the join fails closed.
create or replace function public.staff_role_is_managerial(role public.staff_role)
returns boolean
language sql
immutable
as $$
  select role in ('OWNER', 'MANAGER');
$$;

create or replace function public.user_has_org_membership(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_auth_memberships m
    join public.organizations o on o.app_id = m.organization_id
    where o.id = target_org
      and m.auth_user_id = auth.uid()
      and m.is_active = true
  );
$$;

create or replace function public.user_org_role(target_org uuid)
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role::public.staff_role
  from public.staff_auth_memberships m
  join public.organizations o on o.app_id = m.organization_id
  where o.id = target_org
    and m.auth_user_id = auth.uid()
    and m.is_active = true
  order by case m.role
    when 'OWNER' then 0
    when 'MANAGER' then 1
    else 2
  end
  limit 1;
$$;

create or replace function public.user_can_access_location(target_org uuid, target_loc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_org_membership(target_org)
    and (
      target_loc is null
      or not exists (
        select 1
        from public.staff_auth_membership_locations sml
        join public.staff_auth_memberships m on m.id = sml.membership_id
        join public.organizations o on o.app_id = m.organization_id
        where o.id = target_org
          and m.auth_user_id = auth.uid()
          and m.is_active = true
      )
      or exists (
        select 1
        from public.staff_auth_membership_locations sml
        join public.staff_auth_memberships m on m.id = sml.membership_id
        join public.organizations o on o.app_id = m.organization_id
        join public.locations l
          on l.id = target_loc
         and l.organization_id = target_org
         and l.app_id = sml.location_id
        where o.id = target_org
          and m.auth_user_id = auth.uid()
          and m.is_active = true
      )
    );
$$;

-- Honest replacements for foundation helpers. Not isolation SoT.
-- Returns a uuid only when the Auth user has exactly one active membership
-- that resolves through organizations.app_id. 0 or >1 → NULL.
-- Do not aggregate uuid: min()/max() are undefined for uuid.
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (
      select count(*)
      from public.staff_auth_memberships m
      join public.organizations o on o.app_id = m.organization_id
      where m.auth_user_id = auth.uid()
        and m.is_active = true
    ) = 1
    then (
      select o.id
      from public.staff_auth_memberships m
      join public.organizations o on o.app_id = m.organization_id
      where m.auth_user_id = auth.uid()
        and m.is_active = true
    )
    else null
  end;
$$;

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (
      select count(*)
      from public.staff_auth_memberships m
      where m.auth_user_id = auth.uid()
        and m.is_active = true
    ) = 1
    then (
      select m.role::public.staff_role
      from public.staff_auth_memberships m
      where m.auth_user_id = auth.uid()
        and m.is_active = true
      limit 1
    )
    else null
  end;
$$;

revoke all on function public.staff_role_is_managerial(public.staff_role) from public;
revoke all on function public.user_has_org_membership(uuid) from public;
revoke all on function public.user_org_role(uuid) from public;
revoke all on function public.user_can_access_location(uuid, uuid) from public;
grant execute on function public.staff_role_is_managerial(public.staff_role) to authenticated;
grant execute on function public.user_has_org_membership(uuid) to authenticated;
grant execute on function public.user_org_role(uuid) to authenticated;
grant execute on function public.user_can_access_location(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- customers / services / appointments / treatments ADAPT
-- Do not add derived wallet fields on customers.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists app_id text,
  add column if not exists membership_tier text,
  add column if not exists primary_staff_id text;

create unique index if not exists idx_customers_org_app_id
  on public.customers (organization_id, app_id)
  where app_id is not null;

alter table public.services
  add column if not exists app_id text,
  add column if not exists category text,
  add column if not exists price_minor bigint,
  add column if not exists currency text not null default 'TWD';

alter table public.services
  drop constraint if exists services_price_minor_nonnegative;
alter table public.services
  add constraint services_price_minor_nonnegative
  check (price_minor is null or price_minor >= 0);

create unique index if not exists idx_services_org_app_id
  on public.services (organization_id, app_id)
  where app_id is not null;

alter table public.appointments
  add column if not exists location_id uuid references public.locations (id) on delete restrict,
  add column if not exists app_id text,
  add column if not exists duration_minutes integer,
  add column if not exists customer_name_snapshot text,
  add column if not exists service_name_snapshot text,
  add column if not exists staff_name_snapshot text,
  add column if not exists status_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists updated_by text;

create unique index if not exists idx_appointments_org_app_id
  on public.appointments (organization_id, app_id)
  where app_id is not null;

create index if not exists idx_appointments_org_location_starts
  on public.appointments (organization_id, location_id, starts_at);

alter table public.treatments
  add column if not exists location_id uuid references public.locations (id) on delete restrict,
  add column if not exists app_id text,
  add column if not exists body_map_note text,
  add column if not exists discomfort_note text,
  add column if not exists furthest_step text,
  add column if not exists current_step text;

create unique index if not exists idx_treatments_org_app_id
  on public.treatments (organization_id, app_id)
  where app_id is not null;

create index if not exists idx_treatments_org_location
  on public.treatments (organization_id, location_id);

-- ---------------------------------------------------------------------------
-- products (catalog; no stock column)
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  app_id text,
  name text not null,
  description text,
  sku text,
  barcode text,
  category text,
  price_minor bigint not null,
  currency text not null default 'TWD',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_price_minor_nonnegative check (price_minor >= 0)
);

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create unique index if not exists idx_products_org_app_id
  on public.products (organization_id, app_id)
  where app_id is not null;

create index if not exists idx_products_organization_id
  on public.products (organization_id);

-- ---------------------------------------------------------------------------
-- checkout_drafts (mutable intent) + child rows
-- ---------------------------------------------------------------------------
create table if not exists public.checkout_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  appointment_id uuid references public.appointments (id) on delete restrict,
  treatment_id uuid references public.treatments (id) on delete restrict,
  app_id text,
  subtotal_minor bigint not null default 0,
  discount_total_minor bigint not null default 0,
  total_minor bigint not null default 0,
  currency text not null default 'TWD',
  status public.checkout_draft_status not null default 'OPEN',
  package_redemption jsonb,
  created_by_staff_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_drafts_money_nonnegative check (
    subtotal_minor >= 0
    and discount_total_minor >= 0
    and total_minor >= 0
  )
);

drop trigger if exists trg_checkout_drafts_updated_at on public.checkout_drafts;
create trigger trg_checkout_drafts_updated_at
before update on public.checkout_drafts
for each row execute function public.set_updated_at();

create unique index if not exists idx_checkout_drafts_org_app_id
  on public.checkout_drafts (organization_id, app_id)
  where app_id is not null;

create index if not exists idx_checkout_drafts_org_status
  on public.checkout_drafts (organization_id, status);

create unique index if not exists idx_checkout_drafts_open_appointment
  on public.checkout_drafts (organization_id, appointment_id)
  where appointment_id is not null
    and status in ('OPEN', 'READY');

create table if not exists public.checkout_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  checkout_draft_id uuid not null references public.checkout_drafts (id) on delete cascade,
  app_id text,
  type public.checkout_item_type not null,
  reference_id text,
  name_snapshot text not null,
  unit_price_minor bigint not null,
  quantity integer not null,
  line_subtotal_minor bigint not null,
  discount_amount_minor bigint not null default 0,
  line_total_minor bigint not null,
  session_count_snapshot integer,
  sort_order integer not null default 0,
  constraint checkout_items_qty_positive check (quantity >= 1),
  constraint checkout_items_money_nonnegative check (
    unit_price_minor >= 0
    and line_subtotal_minor >= 0
    and discount_amount_minor >= 0
    and line_total_minor >= 0
  )
);

create index if not exists idx_checkout_items_draft
  on public.checkout_items (checkout_draft_id);

create table if not exists public.checkout_discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  checkout_draft_id uuid not null references public.checkout_drafts (id) on delete cascade,
  app_id text,
  type public.discount_type not null,
  value bigint not null,
  label text,
  reason text,
  created_by_staff_id text,
  constraint checkout_discounts_value_nonnegative check (value >= 0)
);

create index if not exists idx_checkout_discounts_draft
  on public.checkout_discounts (checkout_draft_id);

create table if not exists public.checkout_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  checkout_draft_id uuid not null references public.checkout_drafts (id) on delete cascade,
  app_id text,
  method public.payment_method not null,
  amount_minor bigint not null,
  reference text,
  note text,
  constraint checkout_payments_amount_positive check (amount_minor > 0)
);

create index if not exists idx_checkout_payments_draft
  on public.checkout_payments (checkout_draft_id);

-- ---------------------------------------------------------------------------
-- transactions (immutable settlement snapshot)
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  appointment_id uuid references public.appointments (id) on delete restrict,
  treatment_id uuid references public.treatments (id) on delete restrict,
  checkout_draft_id uuid references public.checkout_drafts (id) on delete restrict,
  app_id text,
  transaction_number text not null,
  status public.transaction_status not null default 'COMPLETED',
  package_redemption jsonb,
  subtotal_minor bigint not null,
  discount_total_minor bigint not null,
  total_minor bigint not null,
  currency text not null default 'TWD',
  created_by_staff_id text not null,
  completed_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  constraint transactions_money_nonnegative check (
    subtotal_minor >= 0
    and discount_total_minor >= 0
    and total_minor >= 0
  )
);

create unique index if not exists idx_transactions_org_app_id
  on public.transactions (organization_id, app_id)
  where app_id is not null;

create unique index if not exists idx_transactions_org_number
  on public.transactions (organization_id, transaction_number);

create unique index if not exists idx_transactions_completed_appointment
  on public.transactions (organization_id, appointment_id)
  where appointment_id is not null and status = 'COMPLETED';

create unique index if not exists idx_transactions_completed_draft
  on public.transactions (organization_id, checkout_draft_id)
  where checkout_draft_id is not null and status = 'COMPLETED';

create index if not exists idx_transactions_org_completed_at
  on public.transactions (organization_id, completed_at desc);

-- Header row may transition COMPLETED → VOIDED; money / snapshots cannot change.
create or replace function public.guard_transaction_settlement_update()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'VOIDED' then
    raise exception 'voided transactions are immutable';
  end if;
  if new.status is distinct from old.status and new.status <> 'VOIDED' then
    raise exception 'transactions may only transition to VOIDED';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.location_id is distinct from old.location_id
     or new.customer_id is distinct from old.customer_id
     or new.appointment_id is distinct from old.appointment_id
     or new.treatment_id is distinct from old.treatment_id
     or new.checkout_draft_id is distinct from old.checkout_draft_id
     or new.app_id is distinct from old.app_id
     or new.transaction_number is distinct from old.transaction_number
     or new.package_redemption is distinct from old.package_redemption
     or new.subtotal_minor is distinct from old.subtotal_minor
     or new.discount_total_minor is distinct from old.discount_total_minor
     or new.total_minor is distinct from old.total_minor
     or new.currency is distinct from old.currency
     or new.created_by_staff_id is distinct from old.created_by_staff_id
     or new.completed_at is distinct from old.completed_at
  then
    raise exception 'transaction settlement snapshots are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transactions_settlement_guard on public.transactions;
create trigger trg_transactions_settlement_guard
before update on public.transactions
for each row execute function public.guard_transaction_settlement_update();

create table if not exists public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  transaction_id uuid not null references public.transactions (id) on delete restrict,
  app_id text,
  type public.checkout_item_type not null,
  reference_id text,
  name_snapshot text not null,
  unit_price_minor bigint not null,
  quantity integer not null,
  line_subtotal_minor bigint not null,
  discount_amount_minor bigint not null default 0,
  line_total_minor bigint not null,
  session_count_snapshot integer,
  sort_order integer not null default 0
);

create index if not exists idx_transaction_items_tx
  on public.transaction_items (transaction_id);

drop trigger if exists trg_transaction_items_immutable on public.transaction_items;
create trigger trg_transaction_items_immutable
before update or delete on public.transaction_items
for each row execute function public.reject_ledger_mutation();

create table if not exists public.transaction_discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  transaction_id uuid not null references public.transactions (id) on delete restrict,
  app_id text,
  type public.discount_type not null,
  value bigint not null,
  label text,
  reason text,
  amount_applied_minor bigint not null
);

create index if not exists idx_transaction_discounts_tx
  on public.transaction_discounts (transaction_id);

drop trigger if exists trg_transaction_discounts_immutable on public.transaction_discounts;
create trigger trg_transaction_discounts_immutable
before update or delete on public.transaction_discounts
for each row execute function public.reject_ledger_mutation();

create table if not exists public.transaction_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  transaction_id uuid not null references public.transactions (id) on delete restrict,
  app_id text,
  method public.payment_method not null,
  amount_minor bigint not null,
  reference text,
  note text,
  paid_at timestamptz not null
);

create index if not exists idx_transaction_payments_tx
  on public.transaction_payments (transaction_id);

drop trigger if exists trg_transaction_payments_immutable on public.transaction_payments;
create trigger trg_transaction_payments_immutable
before update or delete on public.transaction_payments
for each row execute function public.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- packages: definition + customer snapshot + ledger (no remaining column)
-- ---------------------------------------------------------------------------
create table if not exists public.package_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  app_id text,
  name text not null,
  description text,
  included_services jsonb not null default '[]'::jsonb,
  session_count integer not null,
  price_minor bigint not null,
  currency text not null default 'TWD',
  validity_days integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint package_definitions_session_count_positive check (session_count >= 1),
  constraint package_definitions_price_minor_nonnegative check (price_minor >= 0)
);

drop trigger if exists trg_package_definitions_updated_at on public.package_definitions;
create trigger trg_package_definitions_updated_at
before update on public.package_definitions
for each row execute function public.set_updated_at();

create unique index if not exists idx_package_definitions_org_app_id
  on public.package_definitions (organization_id, app_id)
  where app_id is not null;

create table if not exists public.customer_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  package_definition_id uuid not null references public.package_definitions (id) on delete restrict,
  purchase_transaction_id uuid references public.transactions (id) on delete restrict,
  app_id text,
  name_snapshot text not null,
  session_count_snapshot integer not null,
  price_snapshot_minor bigint not null,
  included_service_ids_snapshot text[] not null default '{}',
  purchased_at timestamptz not null,
  activated_at timestamptz,
  expires_at timestamptz,
  status public.customer_package_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_packages_session_count_positive check (session_count_snapshot >= 1),
  constraint customer_packages_price_snapshot_nonnegative check (price_snapshot_minor >= 0)
);

drop trigger if exists trg_customer_packages_updated_at on public.customer_packages;
create trigger trg_customer_packages_updated_at
before update on public.customer_packages
for each row execute function public.set_updated_at();

create unique index if not exists idx_customer_packages_org_app_id
  on public.customer_packages (organization_id, app_id)
  where app_id is not null;

create index if not exists idx_customer_packages_customer
  on public.customer_packages (organization_id, customer_id);

create table if not exists public.package_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  customer_package_id uuid not null references public.customer_packages (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  app_id text,
  type public.package_ledger_type not null,
  session_delta integer not null,
  service_id uuid references public.services (id) on delete restrict,
  appointment_id uuid references public.appointments (id) on delete restrict,
  treatment_id uuid references public.treatments (id) on delete restrict,
  transaction_id uuid references public.transactions (id) on delete restrict,
  location_id uuid references public.locations (id) on delete restrict,
  reason text,
  effect_key text,
  reverses_entry_id uuid references public.package_ledger_entries (id) on delete restrict,
  created_by_staff_id text not null,
  created_at timestamptz not null default now(),
  constraint package_ledger_session_delta_nonzero check (session_delta <> 0)
);

create unique index if not exists idx_package_ledger_org_effect_key
  on public.package_ledger_entries (organization_id, effect_key)
  where effect_key is not null;

create index if not exists idx_package_ledger_package
  on public.package_ledger_entries (customer_package_id, created_at);

create index if not exists idx_package_ledger_org_customer
  on public.package_ledger_entries (organization_id, customer_id);

drop trigger if exists trg_package_ledger_immutable on public.package_ledger_entries;
create trigger trg_package_ledger_immutable
before update or delete on public.package_ledger_entries
for each row execute function public.reject_ledger_mutation();

-- Derived balance view — NOT a stored source of truth
create or replace view public.package_ledger_balances
with (security_invoker = true) as
select
  organization_id,
  customer_package_id,
  sum(session_delta)::integer as ledger_balance
from public.package_ledger_entries
group by organization_id, customer_package_id;

-- ---------------------------------------------------------------------------
-- stored value: account + ledger (no balance column)
-- ---------------------------------------------------------------------------
create table if not exists public.stored_value_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  app_id text,
  currency text not null default 'TWD',
  status public.stored_value_account_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_stored_value_accounts_updated_at on public.stored_value_accounts;
create trigger trg_stored_value_accounts_updated_at
before update on public.stored_value_accounts
for each row execute function public.set_updated_at();

create unique index if not exists idx_stored_value_accounts_org_app_id
  on public.stored_value_accounts (organization_id, app_id)
  where app_id is not null;

create unique index if not exists idx_stored_value_accounts_one_active
  on public.stored_value_accounts (organization_id, customer_id)
  where status = 'ACTIVE';

create table if not exists public.stored_value_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  account_id uuid not null references public.stored_value_accounts (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  app_id text,
  type public.stored_value_ledger_type not null,
  amount_delta_minor bigint not null,
  transaction_id uuid references public.transactions (id) on delete restrict,
  appointment_id uuid references public.appointments (id) on delete restrict,
  location_id uuid references public.locations (id) on delete restrict,
  reason text,
  effect_key text,
  reverses_entry_id uuid references public.stored_value_ledger_entries (id) on delete restrict,
  created_by_staff_id text not null,
  created_at timestamptz not null default now(),
  constraint stored_value_ledger_amount_delta_nonzero check (amount_delta_minor <> 0)
);

create unique index if not exists idx_stored_value_ledger_org_effect_key
  on public.stored_value_ledger_entries (organization_id, effect_key)
  where effect_key is not null;

create index if not exists idx_stored_value_ledger_account
  on public.stored_value_ledger_entries (account_id, created_at);

create index if not exists idx_stored_value_ledger_org_customer
  on public.stored_value_ledger_entries (organization_id, customer_id);

drop trigger if exists trg_stored_value_ledger_immutable on public.stored_value_ledger_entries;
create trigger trg_stored_value_ledger_immutable
before update or delete on public.stored_value_ledger_entries
for each row execute function public.reject_ledger_mutation();

create or replace view public.stored_value_ledger_balances
with (security_invoker = true) as
select
  organization_id,
  account_id,
  customer_id,
  sum(amount_delta_minor)::bigint as ledger_balance_minor
from public.stored_value_ledger_entries
group by organization_id, account_id, customer_id;

-- ---------------------------------------------------------------------------
-- inventory movements (location-scoped SUM)
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  app_id text,
  type public.inventory_movement_type not null,
  quantity_delta integer not null,
  reason text,
  note text,
  transaction_id uuid references public.transactions (id) on delete restrict,
  transaction_item_id uuid references public.transaction_items (id) on delete restrict,
  reverses_movement_id uuid references public.inventory_movements (id) on delete restrict,
  effect_key text,
  created_by_staff_id text not null,
  created_at timestamptz not null default now(),
  constraint inventory_movements_quantity_delta_nonzero check (quantity_delta <> 0)
);

create unique index if not exists idx_inventory_movements_org_effect_key
  on public.inventory_movements (organization_id, effect_key)
  where effect_key is not null;

create index if not exists idx_inventory_movements_stock
  on public.inventory_movements (organization_id, location_id, product_id);

drop trigger if exists trg_inventory_movements_immutable on public.inventory_movements;
create trigger trg_inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.reject_ledger_mutation();

create or replace view public.inventory_stock_balances
with (security_invoker = true) as
select
  organization_id,
  location_id,
  product_id,
  sum(quantity_delta)::integer as stock_quantity
from public.inventory_movements
group by organization_id, location_id, product_id;

-- ---------------------------------------------------------------------------
-- follow_up_tasks (CRM work item ≠ appointment)
-- ---------------------------------------------------------------------------
create table if not exists public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  location_id uuid references public.locations (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  treatment_id uuid references public.treatments (id) on delete restrict,
  source_treatment_id uuid references public.treatments (id) on delete restrict,
  appointment_id uuid references public.appointments (id) on delete restrict,
  assigned_staff_id text,
  app_id text,
  due_at timestamptz not null,
  status public.follow_up_task_status not null default 'OPEN',
  type public.follow_up_task_type not null,
  note text,
  completion_note text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

drop trigger if exists trg_follow_up_tasks_updated_at on public.follow_up_tasks;
create trigger trg_follow_up_tasks_updated_at
before update on public.follow_up_tasks
for each row execute function public.set_updated_at();

create unique index if not exists idx_follow_up_tasks_org_app_id
  on public.follow_up_tasks (organization_id, app_id)
  where app_id is not null;

create unique index if not exists idx_follow_up_tasks_source_treatment
  on public.follow_up_tasks (organization_id, source_treatment_id)
  where source_treatment_id is not null;

create index if not exists idx_follow_up_tasks_org_due
  on public.follow_up_tasks (organization_id, due_at);

-- Operational staff-* CHECKs (never auth UUID)
alter table public.customers drop constraint if exists customers_primary_staff_id_operational;
alter table public.customers
  add constraint customers_primary_staff_id_operational
  check (primary_staff_id is null or public.is_operational_staff_id(primary_staff_id));
alter table public.appointments drop constraint if exists appointments_cancelled_by_operational;
alter table public.appointments
  add constraint appointments_cancelled_by_operational
  check (cancelled_by is null or public.is_operational_staff_id(cancelled_by));
alter table public.appointments drop constraint if exists appointments_updated_by_operational;
alter table public.appointments
  add constraint appointments_updated_by_operational
  check (updated_by is null or public.is_operational_staff_id(updated_by));
alter table public.checkout_drafts drop constraint if exists checkout_drafts_created_by_staff_operational;
alter table public.checkout_drafts
  add constraint checkout_drafts_created_by_staff_operational
  check (public.is_operational_staff_id(created_by_staff_id));
alter table public.checkout_discounts drop constraint if exists checkout_discounts_created_by_staff_operational;
alter table public.checkout_discounts
  add constraint checkout_discounts_created_by_staff_operational
  check (created_by_staff_id is null or public.is_operational_staff_id(created_by_staff_id));
alter table public.transactions drop constraint if exists transactions_created_by_staff_operational;
alter table public.transactions
  add constraint transactions_created_by_staff_operational
  check (public.is_operational_staff_id(created_by_staff_id));
alter table public.transactions drop constraint if exists transactions_voided_by_operational;
alter table public.transactions
  add constraint transactions_voided_by_operational
  check (voided_by is null or public.is_operational_staff_id(voided_by));
alter table public.package_ledger_entries drop constraint if exists package_ledger_created_by_staff_operational;
alter table public.package_ledger_entries
  add constraint package_ledger_created_by_staff_operational
  check (public.is_operational_staff_id(created_by_staff_id));
alter table public.stored_value_ledger_entries drop constraint if exists stored_value_ledger_created_by_staff_operational;
alter table public.stored_value_ledger_entries
  add constraint stored_value_ledger_created_by_staff_operational
  check (public.is_operational_staff_id(created_by_staff_id));
alter table public.inventory_movements drop constraint if exists inventory_movements_created_by_staff_operational;
alter table public.inventory_movements
  add constraint inventory_movements_created_by_staff_operational
  check (public.is_operational_staff_id(created_by_staff_id));
alter table public.follow_up_tasks drop constraint if exists follow_up_tasks_assigned_staff_operational;
alter table public.follow_up_tasks
  add constraint follow_up_tasks_assigned_staff_operational
  check (assigned_staff_id is null or public.is_operational_staff_id(assigned_staff_id));

-- ---------------------------------------------------------------------------
-- RLS: membership-based org isolation for new tables
-- ---------------------------------------------------------------------------
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.checkout_drafts enable row level security;
alter table public.checkout_items enable row level security;
alter table public.checkout_discounts enable row level security;
alter table public.checkout_payments enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;
alter table public.transaction_discounts enable row level security;
alter table public.transaction_payments enable row level security;
alter table public.package_definitions enable row level security;
alter table public.customer_packages enable row level security;
alter table public.package_ledger_entries enable row level security;
alter table public.stored_value_accounts enable row level security;
alter table public.stored_value_ledger_entries enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.follow_up_tasks enable row level security;

-- Recreate Phase 3B table policies to membership helpers (still org-scoped; no data loss)
drop policy if exists customers_select_org on public.customers;
drop policy if exists customers_insert_org on public.customers;
drop policy if exists customers_update_org on public.customers;
drop policy if exists customers_delete_org on public.customers;
create policy customers_select_org on public.customers for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy customers_insert_org on public.customers for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy customers_update_org on public.customers for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));
create policy customers_delete_org on public.customers for delete to authenticated
  using (
    public.user_has_org_membership(organization_id)
    and public.staff_role_is_managerial(public.user_org_role(organization_id))
  );

drop policy if exists customer_consultations_select_org on public.customer_consultations;
drop policy if exists customer_consultations_insert_org on public.customer_consultations;
drop policy if exists customer_consultations_update_org on public.customer_consultations;
drop policy if exists customer_consultations_delete_org on public.customer_consultations;
create policy customer_consultations_select_org on public.customer_consultations for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy customer_consultations_insert_org on public.customer_consultations for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy customer_consultations_update_org on public.customer_consultations for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));
create policy customer_consultations_delete_org on public.customer_consultations for delete to authenticated
  using (public.user_has_org_membership(organization_id));

drop policy if exists services_select_org on public.services;
drop policy if exists services_insert_org on public.services;
drop policy if exists services_update_org on public.services;
drop policy if exists services_delete_org on public.services;
create policy services_select_org on public.services for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy services_insert_org on public.services for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy services_update_org on public.services for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));
create policy services_delete_org on public.services for delete to authenticated
  using (
    public.user_has_org_membership(organization_id)
    and public.staff_role_is_managerial(public.user_org_role(organization_id))
  );

drop policy if exists appointments_select_org on public.appointments;
drop policy if exists appointments_insert_org on public.appointments;
drop policy if exists appointments_update_org on public.appointments;
drop policy if exists appointments_delete_org on public.appointments;
create policy appointments_select_org on public.appointments for select to authenticated
  using (
    public.user_has_org_membership(organization_id)
    and public.user_can_access_location(organization_id, location_id)
  );
create policy appointments_insert_org on public.appointments for insert to authenticated
  with check (
    public.user_has_org_membership(organization_id)
    and public.user_can_access_location(organization_id, location_id)
  );
create policy appointments_update_org on public.appointments for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (
    public.user_has_org_membership(organization_id)
    and public.user_can_access_location(organization_id, location_id)
  );
create policy appointments_delete_org on public.appointments for delete to authenticated
  using (
    public.user_has_org_membership(organization_id)
    and public.staff_role_is_managerial(public.user_org_role(organization_id))
  );

drop policy if exists treatments_select_org on public.treatments;
drop policy if exists treatments_insert_org on public.treatments;
drop policy if exists treatments_update_org on public.treatments;
drop policy if exists treatments_delete_org on public.treatments;
create policy treatments_select_org on public.treatments for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy treatments_insert_org on public.treatments for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy treatments_update_org on public.treatments for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));
create policy treatments_delete_org on public.treatments for delete to authenticated
  using (
    public.user_has_org_membership(organization_id)
    and public.staff_role_is_managerial(public.user_org_role(organization_id))
  );

drop policy if exists treatment_photos_select_org on public.treatment_photos;
drop policy if exists treatment_photos_insert_org on public.treatment_photos;
drop policy if exists treatment_photos_update_org on public.treatment_photos;
drop policy if exists treatment_photos_delete_org on public.treatment_photos;
create policy treatment_photos_select_org on public.treatment_photos for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy treatment_photos_insert_org on public.treatment_photos for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy treatment_photos_update_org on public.treatment_photos for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));
create policy treatment_photos_delete_org on public.treatment_photos for delete to authenticated
  using (public.user_has_org_membership(organization_id));

drop policy if exists organizations_select_own on public.organizations;
create policy organizations_select_own on public.organizations for select to authenticated
  using (public.user_has_org_membership(id));

drop policy if exists profiles_select_own_or_org on public.profiles;
create policy profiles_select_own_or_org on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.user_has_org_membership(organization_id)
  );

drop policy if exists audit_logs_insert_org on public.audit_logs;
drop policy if exists audit_logs_select_managers on public.audit_logs;
create policy audit_logs_insert_org on public.audit_logs for insert to authenticated
  with check (
    public.user_has_org_membership(organization_id)
    and (
      actor_id is null
      or exists (
        select 1
        from public.staff_auth_memberships m
        join public.organizations o on o.app_id = m.organization_id
        where o.id = organization_id
          and m.auth_user_id = auth.uid()
          and m.is_active = true
          and m.user_id = actor_id
      )
    )
  );
create policy audit_logs_select_managers on public.audit_logs for select to authenticated
  using (
    public.user_has_org_membership(organization_id)
    and public.staff_role_is_managerial(public.user_org_role(organization_id))
  );

-- Generic org member policies for new tables
drop policy if exists products_select_org on public.products;
drop policy if exists products_insert_org on public.products;
drop policy if exists products_update_org on public.products;
drop policy if exists checkout_drafts_select_org on public.checkout_drafts;
drop policy if exists checkout_drafts_insert_org on public.checkout_drafts;
drop policy if exists checkout_drafts_update_org on public.checkout_drafts;
drop policy if exists checkout_items_select_org on public.checkout_items;
drop policy if exists checkout_items_insert_org on public.checkout_items;
drop policy if exists checkout_items_update_org on public.checkout_items;
drop policy if exists checkout_items_delete_org on public.checkout_items;
drop policy if exists checkout_discounts_select_org on public.checkout_discounts;
drop policy if exists checkout_discounts_insert_org on public.checkout_discounts;
drop policy if exists checkout_discounts_update_org on public.checkout_discounts;
drop policy if exists checkout_discounts_delete_org on public.checkout_discounts;
drop policy if exists checkout_payments_select_org on public.checkout_payments;
drop policy if exists checkout_payments_insert_org on public.checkout_payments;
drop policy if exists checkout_payments_update_org on public.checkout_payments;
drop policy if exists checkout_payments_delete_org on public.checkout_payments;
drop policy if exists transactions_select_org on public.transactions;
drop policy if exists transactions_insert_org on public.transactions;
drop policy if exists transactions_update_org on public.transactions;
drop policy if exists transaction_items_select_org on public.transaction_items;
drop policy if exists transaction_items_insert_org on public.transaction_items;
drop policy if exists transaction_discounts_select_org on public.transaction_discounts;
drop policy if exists transaction_discounts_insert_org on public.transaction_discounts;
drop policy if exists transaction_payments_select_org on public.transaction_payments;
drop policy if exists transaction_payments_insert_org on public.transaction_payments;
drop policy if exists package_definitions_select_org on public.package_definitions;
drop policy if exists package_definitions_insert_org on public.package_definitions;
drop policy if exists package_definitions_update_org on public.package_definitions;
drop policy if exists customer_packages_select_org on public.customer_packages;
drop policy if exists customer_packages_insert_org on public.customer_packages;
drop policy if exists customer_packages_update_org on public.customer_packages;
drop policy if exists package_ledger_select_org on public.package_ledger_entries;
drop policy if exists package_ledger_insert_org on public.package_ledger_entries;
drop policy if exists stored_value_accounts_select_org on public.stored_value_accounts;
drop policy if exists stored_value_accounts_insert_org on public.stored_value_accounts;
drop policy if exists stored_value_accounts_update_org on public.stored_value_accounts;
drop policy if exists stored_value_ledger_select_org on public.stored_value_ledger_entries;
drop policy if exists stored_value_ledger_insert_org on public.stored_value_ledger_entries;
drop policy if exists inventory_movements_select_org on public.inventory_movements;
drop policy if exists inventory_movements_insert_org on public.inventory_movements;
drop policy if exists follow_up_tasks_select_org on public.follow_up_tasks;
drop policy if exists follow_up_tasks_insert_org on public.follow_up_tasks;
drop policy if exists follow_up_tasks_update_org on public.follow_up_tasks;
drop policy if exists locations_insert_org on public.locations;
drop policy if exists locations_update_org on public.locations;
-- locations
drop policy if exists locations_select_org on public.locations;
drop policy if exists locations_write_org on public.locations;
create policy locations_select_org on public.locations for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy locations_insert_org on public.locations for insert to authenticated
  with check (
    public.user_has_org_membership(organization_id)
    and public.staff_role_is_managerial(public.user_org_role(organization_id))
  );
create policy locations_update_org on public.locations for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (
    public.user_has_org_membership(organization_id)
    and public.staff_role_is_managerial(public.user_org_role(organization_id))
  );

-- Canonical membership: authenticated may SELECT colleagues in orgs they
-- actively belong to. Writes stay service-role only (no insert/update policy).
drop policy if exists staff_auth_memberships_select_org on public.staff_auth_memberships;
create policy staff_auth_memberships_select_org
on public.staff_auth_memberships
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or exists (
    select 1
    from public.organizations o
    where o.app_id = organization_id
      and public.user_has_org_membership(o.id)
  )
);

drop policy if exists staff_auth_membership_locations_select_org
  on public.staff_auth_membership_locations;
create policy staff_auth_membership_locations_select_org
on public.staff_auth_membership_locations
for select
to authenticated
using (
  exists (
    select 1
    from public.staff_auth_memberships m
    join public.organizations o on o.app_id = m.organization_id
    where m.id = membership_id
      and (
        m.auth_user_id = auth.uid()
        or public.user_has_org_membership(o.id)
      )
  )
);

-- Helper macro-style policies via repeated patterns
create policy products_select_org on public.products for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy products_insert_org on public.products for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy products_update_org on public.products for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));

create policy checkout_drafts_select_org on public.checkout_drafts for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy checkout_drafts_insert_org on public.checkout_drafts for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy checkout_drafts_update_org on public.checkout_drafts for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));

create policy checkout_items_select_org on public.checkout_items for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy checkout_items_insert_org on public.checkout_items for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy checkout_items_update_org on public.checkout_items for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));
create policy checkout_items_delete_org on public.checkout_items for delete to authenticated
  using (public.user_has_org_membership(organization_id));

create policy checkout_discounts_select_org on public.checkout_discounts for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy checkout_discounts_insert_org on public.checkout_discounts for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy checkout_discounts_update_org on public.checkout_discounts for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));
create policy checkout_discounts_delete_org on public.checkout_discounts for delete to authenticated
  using (public.user_has_org_membership(organization_id));

create policy checkout_payments_select_org on public.checkout_payments for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy checkout_payments_insert_org on public.checkout_payments for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy checkout_payments_update_org on public.checkout_payments for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));
create policy checkout_payments_delete_org on public.checkout_payments for delete to authenticated
  using (public.user_has_org_membership(organization_id));

-- Transactions: select/insert; update allowed for VOIDED transition (app-enforced);
-- no delete (history must survive customer/service changes via RESTRICT FKs)
create policy transactions_select_org on public.transactions for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy transactions_insert_org on public.transactions for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy transactions_update_org on public.transactions for update to authenticated
  using (
    public.user_has_org_membership(organization_id)
    and public.staff_role_is_managerial(public.user_org_role(organization_id))
  )
  with check (public.user_has_org_membership(organization_id));

create policy transaction_items_select_org on public.transaction_items for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy transaction_items_insert_org on public.transaction_items for insert to authenticated
  with check (public.user_has_org_membership(organization_id));

create policy transaction_discounts_select_org on public.transaction_discounts for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy transaction_discounts_insert_org on public.transaction_discounts for insert to authenticated
  with check (public.user_has_org_membership(organization_id));

create policy transaction_payments_select_org on public.transaction_payments for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy transaction_payments_insert_org on public.transaction_payments for insert to authenticated
  with check (public.user_has_org_membership(organization_id));

create policy package_definitions_select_org on public.package_definitions for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy package_definitions_insert_org on public.package_definitions for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy package_definitions_update_org on public.package_definitions for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));

create policy customer_packages_select_org on public.customer_packages for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy customer_packages_insert_org on public.customer_packages for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy customer_packages_update_org on public.customer_packages for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));

create policy package_ledger_select_org on public.package_ledger_entries for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy package_ledger_insert_org on public.package_ledger_entries for insert to authenticated
  with check (public.user_has_org_membership(organization_id));

create policy stored_value_accounts_select_org on public.stored_value_accounts for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy stored_value_accounts_insert_org on public.stored_value_accounts for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy stored_value_accounts_update_org on public.stored_value_accounts for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));

create policy stored_value_ledger_select_org on public.stored_value_ledger_entries for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy stored_value_ledger_insert_org on public.stored_value_ledger_entries for insert to authenticated
  with check (public.user_has_org_membership(organization_id));

create policy inventory_movements_select_org on public.inventory_movements for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy inventory_movements_insert_org on public.inventory_movements for insert to authenticated
  with check (public.user_has_org_membership(organization_id));

create policy follow_up_tasks_select_org on public.follow_up_tasks for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy follow_up_tasks_insert_org on public.follow_up_tasks for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create policy follow_up_tasks_update_org on public.follow_up_tasks for update to authenticated
  using (public.user_has_org_membership(organization_id))
  with check (public.user_has_org_membership(organization_id));

grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update, delete on public.checkout_drafts to authenticated;
grant select, insert, update, delete on public.checkout_items to authenticated;
grant select, insert, update, delete on public.checkout_discounts to authenticated;
grant select, insert, update, delete on public.checkout_payments to authenticated;
grant select, insert, update on public.transactions to authenticated;
grant select, insert on public.transaction_items to authenticated;
grant select, insert on public.transaction_discounts to authenticated;
grant select, insert on public.transaction_payments to authenticated;
grant select, insert, update on public.package_definitions to authenticated;
grant select, insert, update on public.customer_packages to authenticated;
grant select, insert on public.package_ledger_entries to authenticated;
grant select, insert, update on public.stored_value_accounts to authenticated;
grant select, insert on public.stored_value_ledger_entries to authenticated;
grant select, insert on public.inventory_movements to authenticated;
grant select, insert, update on public.follow_up_tasks to authenticated;
grant select on public.package_ledger_balances to authenticated;
grant select on public.stored_value_ledger_balances to authenticated;
grant select on public.inventory_stock_balances to authenticated;
