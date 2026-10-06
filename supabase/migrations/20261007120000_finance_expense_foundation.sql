-- =============================================================================
-- Finance V1B — Expense foundation (additive)
--
-- Money-out domain. Do not reuse transaction_payments.
-- Income remains canonical public.transactions.
-- Additive only. No DROP of business tables. No business INSERTs / seed.
-- V1B grants SELECT + INSERT only. UPDATE / DELETE stay closed.
-- INSERT is OWNER / MANAGER only. STAFF / RECEPTIONIST / ACCOUNTANT denied.
-- =============================================================================

do $$ begin
  create type public.expense_category as enum (
    'RENT',
    'UTILITIES',
    'SUPPLIES',
    'PRODUCTS',
    'SALARY',
    'MARKETING',
    'EQUIPMENT',
    'MAINTENANCE',
    'FEES',
    'TAX',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.expense_payment_method as enum (
    'CASH',
    'TRANSFER',
    'CARD',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  app_id text not null,
  expense_date date not null,
  category public.expense_category not null,
  name text not null,
  amount_minor integer not null,
  payment_method public.expense_payment_method,
  vendor text,
  note text,
  receipt_url text,
  created_by_staff_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_amount_minor_positive check (amount_minor > 0),
  constraint expenses_name_not_blank check (length(btrim(name)) > 0),
  constraint expenses_app_id_unique unique (app_id),
  constraint expenses_app_id_format check (app_id ~ '^exp-[a-z0-9]+-[a-z0-9]+$'),
  constraint expenses_created_by_operational
    check (public.is_operational_staff_id(created_by_staff_id))
);

create index if not exists idx_expenses_org_location_date
  on public.expenses (organization_id, location_id, expense_date desc);

alter table public.expenses enable row level security;

drop policy if exists expenses_select_org on public.expenses;
create policy expenses_select_org on public.expenses
  for select to authenticated
  using (
    public.user_has_org_membership(expenses.organization_id)
    and public.user_can_access_location(expenses.organization_id, expenses.location_id)
  );

create or replace function public.user_operational_staff_id(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
  from public.staff_auth_memberships m
  join public.organizations o on o.app_id = m.organization_id
  where o.id = target_org
    and m.auth_user_id = auth.uid()
    and m.is_active = true
  limit 1;
$$;

revoke all on function public.user_operational_staff_id(uuid) from public;
grant execute on function public.user_operational_staff_id(uuid) to authenticated;

drop policy if exists expenses_insert_org on public.expenses;
create policy expenses_insert_org on public.expenses
  for insert to authenticated
  with check (
    expenses.location_id is not null
    and public.user_has_org_membership(expenses.organization_id)
    and public.user_can_access_location(expenses.organization_id, expenses.location_id)
    and public.staff_role_is_managerial(public.user_org_role(expenses.organization_id))
    and public.is_operational_staff_id(expenses.created_by_staff_id)
    and expenses.created_by_staff_id = public.user_operational_staff_id(expenses.organization_id)
  );

-- V1B does not open UPDATE / DELETE even if earlier drafts created these policies.
drop policy if exists expenses_update_org on public.expenses;
drop policy if exists expenses_delete_org on public.expenses;

revoke all on public.expenses from public, anon, authenticated;
grant select, insert on public.expenses to authenticated;
grant usage on type public.expense_category to authenticated;
grant usage on type public.expense_payment_method to authenticated;

comment on table public.expenses is
  'Finance V1B money-out. Income stays on public.transactions. SELECT + INSERT only. UPDATE / DELETE closed.';
