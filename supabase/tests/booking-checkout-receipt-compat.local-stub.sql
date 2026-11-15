-- Isolated booking checkout compatibility fixture. Local PostgreSQL only.
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
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
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

create table if not exists public.organizations (
  id uuid primary key
);

create table if not exists public.customers (
  id uuid primary key,
  organization_id uuid not null,
  status text not null
);

create table if not exists public.locations (
  id uuid primary key,
  organization_id uuid not null
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

create table if not exists public.customer_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  app_id text not null,
  status text not null,
  expires_at timestamptz,
  included_service_ids_snapshot text[] not null
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
  package_redemption jsonb,
  created_by_staff_id text not null,
  updated_at timestamptz not null default now()
);

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
  note text
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
  package_redemption jsonb,
  subtotal_minor bigint not null,
  discount_total_minor bigint not null,
  total_minor bigint not null,
  currency text not null,
  created_by_staff_id text not null,
  completed_at timestamptz not null
);

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
  discount_amount_minor bigint not null default 0,
  line_total_minor bigint not null,
  session_count_snapshot integer,
  sort_order integer not null default 0
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

create table if not exists tests.controls (
  fail_package boolean not null default false
);

insert into tests.controls (fail_package)
select false
where not exists (select 1 from tests.controls);

create table if not exists tests.package_effects (
  transaction_id uuid primary key,
  package_redemption jsonb
);

create or replace function public.package_ledger_balance(p_package uuid)
returns integer
language sql
stable
as $$
  select 3;
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
  select least(
    greatest(p_remaining, 0),
    case p_type
      when 'ORDER_PERCENTAGE' then (p_subtotal * p_value) / 100
      else p_value
    end
  );
$$;

create or replace function public.next_transaction_number(p_org uuid, p_at timestamptz)
returns text
language sql
volatile
as $$
  select 'T-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
$$;

create or replace function public.assert_commerce_checkout_actor(p_org uuid, p_location uuid)
returns text
language plpgsql
stable
as $$
begin
  if auth.uid() is null then
    raise exception '沒有權限結帳';
  end if;
  return 'staff-owner-test';
end;
$$;

create or replace function public.commerce_checkout_bundle(p_draft public.checkout_drafts)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'draft', jsonb_build_object(
      'id', p_draft.app_id,
      'status', p_draft.status,
      'packageRedemption', p_draft.package_redemption,
      'total', p_draft.total_minor
    )
  );
$$;

create or replace function public.apply_package_effects_for_transaction(
  p_tx public.transactions,
  p_draft public.checkout_drafts,
  p_staff_id text
) returns void
language plpgsql
as $$
begin
  if coalesce((select fail_package from tests.controls limit 1), false) then
    raise exception '套票回滾測試';
  end if;
  insert into tests.package_effects (transaction_id, package_redemption)
  values (p_tx.id, p_tx.package_redemption)
  on conflict (transaction_id) do nothing;
end;
$$;

create or replace function tests.draft_updated_at(p_app text)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select updated_at from public.checkout_drafts where app_id = p_app;
$$;

create or replace function tests.open_draft(
  p_app text,
  p_service_minor bigint,
  p_product_minor bigint
) returns timestamptz
language plpgsql
as $$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_customer uuid := '33333333-3333-4333-8333-333333333333';
  v_location uuid := '22222222-2222-4222-8222-222222222222';
  v_draft uuid;
  v_appointment uuid;
  v_treatment uuid;
  v_at timestamptz;
begin
  insert into public.appointments (id, organization_id, status)
  values (gen_random_uuid(), v_org, 'BOOKED')
  returning id into v_appointment;
  insert into public.treatments (id, organization_id, status)
  values (gen_random_uuid(), v_org, 'COMPLETED')
  returning id into v_treatment;
  insert into public.checkout_drafts (
    organization_id, location_id, customer_id, appointment_id, treatment_id,
    app_id, subtotal_minor, discount_total_minor, total_minor, currency,
    status, created_by_staff_id
  ) values (
    v_org, v_location, v_customer,
    v_appointment,
    v_treatment,
    p_app, p_service_minor + p_product_minor, 0, p_service_minor + p_product_minor,
    'TWD', 'OPEN', 'staff-owner-test'
  ) returning id, updated_at into v_draft, v_at;
  insert into public.checkout_items (
    organization_id, checkout_draft_id, app_id, type, reference_id, name_snapshot,
    unit_price_minor, quantity, line_subtotal_minor, discount_amount_minor, line_total_minor, sort_order
  ) values (
    v_org, v_draft, p_app || '-svc', 'SERVICE', 'svc-compat-0001', '隔離服務',
    p_service_minor, 1, p_service_minor, 0, p_service_minor, 0
  );
  if p_product_minor > 0 then
    insert into public.checkout_items (
      organization_id, checkout_draft_id, app_id, type, reference_id, name_snapshot,
      unit_price_minor, quantity, line_subtotal_minor, discount_amount_minor, line_total_minor, sort_order
    ) values (
      v_org, v_draft, p_app || '-prd', 'PRODUCT', 'prd-compat-0001', '隔離商品',
      p_product_minor, 1, p_product_minor, 0, p_product_minor, 1
    );
  end if;
  return v_at;
end;
$$;

revoke all on function tests.draft_updated_at(text) from public;
grant usage on schema tests to authenticated;
grant execute on function tests.draft_updated_at(text) to authenticated;
