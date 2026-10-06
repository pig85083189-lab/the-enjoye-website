-- =============================================================================
-- Finance V1A — Expense foundation (additive)
--
-- Money-out domain. Do not reuse transaction_payments.
-- Income remains canonical public.transactions.
-- Additive only. No DROP of business tables. No business INSERTs.
-- V1A grants SELECT only. WRITE grants stay closed until Expense WRITE canary.
-- =============================================================================

do $$ begin
  create type public.expense_category as enum (
    'SUPPLIES',
    'PRODUCT_INVENTORY',
    'SALARY',
    'RENT',
    'UTILITIES',
    'MARKETING',
    'EQUIPMENT',
    'TRAINING',
    'SOFTWARE',
    'TAX',
    'MISC',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.expense_payment_method as enum (
    'CASH',
    'CARD',
    'TRANSFER',
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
  payment_method public.expense_payment_method not null default 'CASH',
  vendor text,
  note text,
  receipt_url text,
  created_by_staff_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_amount_minor_positive check (amount_minor > 0),
  constraint expenses_app_id_unique unique (app_id)
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

drop policy if exists expenses_insert_org on public.expenses;
create policy expenses_insert_org on public.expenses
  for insert to authenticated
  with check (
    expenses.location_id is not null
    and public.user_has_org_membership(expenses.organization_id)
    and public.user_can_access_location(expenses.organization_id, expenses.location_id)
  );

drop policy if exists expenses_update_org on public.expenses;
create policy expenses_update_org on public.expenses
  for update to authenticated
  using (
    public.user_has_org_membership(expenses.organization_id)
    and public.user_can_access_location(expenses.organization_id, expenses.location_id)
  )
  with check (
    public.user_has_org_membership(expenses.organization_id)
    and public.user_can_access_location(expenses.organization_id, expenses.location_id)
  );

drop policy if exists expenses_delete_org on public.expenses;
create policy expenses_delete_org on public.expenses
  for delete to authenticated
  using (
    public.user_has_org_membership(expenses.organization_id)
    and public.user_can_access_location(expenses.organization_id, expenses.location_id)
    and public.staff_role_is_managerial(public.user_org_role(expenses.organization_id))
  );

revoke all on public.expenses from public, anon, authenticated;
grant select on public.expenses to authenticated;

comment on table public.expenses is
  'Finance V1 money-out. Income stays on public.transactions. WRITE grants closed until Expense WRITE canary.';
