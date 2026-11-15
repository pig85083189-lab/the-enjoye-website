-- Isolated checkout debit fixture. Local PostgreSQL only. No customer data.
create schema if not exists auth;
create schema if not exists tests;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('tests.uid', true), '')::uuid;
$$;

do $$ begin
  create type public.payment_method as enum (
    'CASH', 'CARD', 'TRANSFER', 'OTHER', 'STORED_VALUE', 'PACKAGE'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.discount_type as enum ('ORDER_FIXED', 'ORDER_PERCENTAGE');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.checkout_item_type as enum (
    'SERVICE', 'PRODUCT', 'CUSTOM', 'PACKAGE_PURCHASE', 'STORED_VALUE_TOP_UP'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.checkout_draft_status as enum ('OPEN', 'READY', 'COMPLETED', 'VOIDED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.stored_value_ledger_type as enum (
    'TOP_UP', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.organizations (
  id uuid primary key,
  app_id text not null unique
);

create table if not exists public.customers (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  status text not null
);

create table if not exists public.member_line_customer_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  verified_at timestamptz,
  unique (organization_id, customer_id)
);

create table if not exists public.line_customer_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  customer_uuid uuid,
  status text,
  verified boolean,
  confirmed_at timestamptz,
  bound_at timestamptz,
  unbound_at timestamptz,
  blocked_at timestamptz,
  line_user_id_hash text
);

create table if not exists public.appointments (
  id uuid primary key,
  organization_id uuid not null,
  status text not null
);

create table if not exists public.treatments (
  id uuid primary key,
  organization_id uuid not null,
  status text not null
);

create table if not exists public.checkout_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  customer_id uuid not null,
  appointment_id uuid,
  treatment_id uuid,
  app_id text unique,
  subtotal_minor bigint not null default 0,
  discount_total_minor bigint not null default 0,
  total_minor bigint not null default 0,
  currency text not null default 'TWD',
  status public.checkout_draft_status not null default 'OPEN',
  created_by_staff_id text not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_checkout_drafts_open_appointment
  on public.checkout_drafts (organization_id, appointment_id)
  where appointment_id is not null and status in ('OPEN', 'READY');

create table if not exists public.checkout_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  checkout_draft_id uuid not null references public.checkout_drafts (id),
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

create table if not exists public.checkout_discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  checkout_draft_id uuid not null references public.checkout_drafts (id),
  app_id text,
  type public.discount_type not null,
  value bigint not null,
  label text,
  reason text,
  created_by_staff_id text
);

create table if not exists public.checkout_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  checkout_draft_id uuid not null references public.checkout_drafts (id),
  app_id text,
  method public.payment_method not null,
  amount_minor bigint not null,
  reference text,
  note text,
  constraint checkout_payments_amount_positive check (amount_minor > 0)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  customer_id uuid not null,
  appointment_id uuid,
  treatment_id uuid,
  checkout_draft_id uuid,
  app_id text,
  transaction_number text not null,
  status text not null,
  subtotal_minor bigint not null,
  discount_total_minor bigint not null,
  total_minor bigint not null,
  currency text not null,
  created_by_staff_id text not null,
  completed_at timestamptz not null
);

create unique index if not exists idx_transactions_completed_appointment
  on public.transactions (organization_id, appointment_id)
  where appointment_id is not null and status = 'COMPLETED';

create unique index if not exists idx_transactions_completed_draft
  on public.transactions (organization_id, checkout_draft_id)
  where checkout_draft_id is not null and status = 'COMPLETED';

create table if not exists public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  transaction_id uuid not null references public.transactions (id),
  app_id text,
  type public.checkout_item_type not null,
  reference_id text,
  name_snapshot text not null,
  unit_price_minor bigint not null,
  quantity integer not null,
  line_subtotal_minor bigint not null,
  discount_amount_minor bigint not null,
  line_total_minor bigint not null,
  session_count_snapshot integer,
  sort_order integer not null
);

create table if not exists public.transaction_discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  transaction_id uuid not null references public.transactions (id),
  app_id text,
  type public.discount_type not null,
  value bigint not null,
  label text,
  reason text,
  amount_applied_minor bigint not null
);

create table if not exists public.transaction_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  transaction_id uuid not null references public.transactions (id),
  app_id text,
  method public.payment_method not null,
  amount_minor bigint not null,
  reference text,
  note text,
  paid_at timestamptz not null
);

create table if not exists public.stored_value_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  currency text not null,
  status text not null
);

create unique index if not exists idx_stored_value_accounts_one_active
  on public.stored_value_accounts (organization_id, customer_id)
  where status = 'ACTIVE';

create table if not exists public.stored_value_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  account_id uuid not null references public.stored_value_accounts (id),
  customer_id uuid not null,
  type public.stored_value_ledger_type not null,
  amount_delta_minor bigint not null,
  transaction_id uuid references public.transactions (id),
  appointment_id uuid,
  location_id uuid,
  reason text,
  effect_key text,
  created_by_staff_id text not null,
  created_at timestamptz not null default now(),
  constraint stored_value_ledger_amount_delta_nonzero check (amount_delta_minor <> 0)
);

create unique index if not exists idx_stored_value_ledger_org_effect_key
  on public.stored_value_ledger_entries (organization_id, effect_key)
  where effect_key is not null;

create or replace function public.reject_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ledger is immutable';
end;
$$;

drop trigger if exists trg_stored_value_ledger_immutable on public.stored_value_ledger_entries;
create trigger trg_stored_value_ledger_immutable
before update or delete on public.stored_value_ledger_entries
for each row execute function public.reject_ledger_mutation();

create or replace function tests.reject_forced_payment()
returns trigger
language plpgsql
as $$
begin
  if new.note = 'FORCE_ROLLBACK' then
    raise exception 'forced_payment_failure';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_forced_payment on public.transaction_payments;
create trigger trg_reject_forced_payment
before insert on public.transaction_payments
for each row execute function tests.reject_forced_payment();

create or replace function public.assert_commerce_checkout_actor(p_org uuid, p_loc uuid)
returns text
language plpgsql
stable
as $$
begin
  if auth.uid() is null or p_org is null or p_loc is null then
    raise exception '沒有權限結帳';
  end if;
  return 'staff-test-1';
end;
$$;

create or replace function public.checkout_discount_amount(
  p_subtotal bigint,
  p_remaining bigint,
  p_type public.discount_type,
  p_value bigint
) returns bigint
language sql
immutable
as $$
  select case when p_type = 'ORDER_FIXED' then least(p_remaining, p_value) else 0 end;
$$;

create or replace function public.commerce_checkout_bundle(p_draft public.checkout_drafts)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p_draft.id,
    'status', p_draft.status,
    'total', p_draft.total_minor
  );
$$;

create or replace function public.next_transaction_number(p_org uuid, p_at timestamptz)
returns text
language sql
volatile
as $$
  select 'TX-' || to_char(p_at at time zone 'UTC', 'YYYYMMDD') || '-' ||
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
$$;

create table if not exists tests.gate (
  id integer primary key,
  open boolean not null
);

insert into public.organizations (id, app_id)
values ('11111111-1111-4111-8111-111111111111', 'org-stored-value-test')
on conflict (id) do nothing;
