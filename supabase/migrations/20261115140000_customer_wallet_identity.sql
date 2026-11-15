-- Confirmed booking-customer to wallet-customer mapping.
-- Ledger rows stay append-only. This table does not update or copy stored-value history.
-- A link is created only by confirm_customer_wallet_identity, which requires a managerial staff session.
-- The function identifies customers by app id inside one organization.

create table if not exists public.customer_wallet_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  booking_customer_id uuid not null references public.customers (id) on delete restrict,
  wallet_customer_id uuid not null references public.customers (id) on delete restrict,
  status text not null default 'ACTIVE',
  reason text not null,
  confirmed_by_staff_id text not null,
  confirmed_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_staff_id text,
  constraint customer_wallet_identities_distinct check (booking_customer_id <> wallet_customer_id),
  constraint customer_wallet_identities_status check (status in ('ACTIVE', 'REVOKED')),
  constraint customer_wallet_identities_reason check (char_length(btrim(reason)) >= 8),
  constraint customer_wallet_identities_confirmed_staff check (public.is_operational_staff_id(confirmed_by_staff_id)),
  constraint customer_wallet_identities_revoked_staff check (
    revoked_by_staff_id is null or public.is_operational_staff_id(revoked_by_staff_id)
  )
);

create unique index if not exists customer_wallet_identities_active_booking
  on public.customer_wallet_identities (organization_id, booking_customer_id)
  where status = 'ACTIVE';

create unique index if not exists customer_wallet_identities_active_wallet
  on public.customer_wallet_identities (organization_id, wallet_customer_id)
  where status = 'ACTIVE';

create or replace function public.customer_wallet_identities_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.customers c
    where c.id = new.booking_customer_id and c.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.customers c
    where c.id = new.wallet_customer_id and c.organization_id = new.organization_id
  ) then
    raise exception '顧客帳號無效';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customer_wallet_identities_guard on public.customer_wallet_identities;
create trigger trg_customer_wallet_identities_guard
before insert or update on public.customer_wallet_identities
for each row execute function public.customer_wallet_identities_guard();

alter table public.customer_wallet_identities enable row level security;

drop policy if exists customer_wallet_identities_select_org on public.customer_wallet_identities;
create policy customer_wallet_identities_select_org
  on public.customer_wallet_identities
  for select to authenticated
  using (public.user_has_org_membership(organization_id));

revoke all on public.customer_wallet_identities from public, anon, authenticated;
grant select on public.customer_wallet_identities to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on public.customer_wallet_identities from service_role';
    execute 'grant select on public.customer_wallet_identities to service_role';
  end if;
end $$;

create or replace function public.confirm_customer_wallet_identity(
  p_organization_app_id text,
  p_booking_customer_app_id text,
  p_wallet_customer_app_id text,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_org_app text;
  v_booking uuid;
  v_wallet uuid;
  v_staff text;
  v_role public.staff_role;
  v_existing uuid;
  v_existing_count integer;
begin
  if auth.uid() is null then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 8 or char_length(p_reason) > 200 then
    raise exception '請填寫身分對應原因';
  end if;
  if p_booking_customer_app_id is null or p_wallet_customer_app_id is null
     or btrim(p_booking_customer_app_id) = '' or btrim(p_wallet_customer_app_id) = ''
     or p_booking_customer_app_id = p_wallet_customer_app_id then
    raise exception '不可將顧客對應到自己';
  end if;

  select o.id, o.app_id into v_org, v_org_app
  from public.organizations o
  where o.app_id = p_organization_app_id;
  if v_org is null then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  v_role := public.user_org_role(v_org);
  if v_role is null or not public.staff_role_is_managerial(v_role) then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  v_staff := public.current_operational_staff_id(v_org);
  if v_staff is null then
    raise exception '沒有權限建立顧客身分對應';
  end if;

  select c.id into v_booking
  from public.customers c
  where c.organization_id = v_org
    and c.app_id = p_booking_customer_app_id
    and c.status = 'ACTIVE'
  for update;
  if v_booking is null then
    raise exception '顧客帳號無效';
  end if;
  select c.id into v_wallet
  from public.customers c
  where c.organization_id = v_org
    and c.app_id = p_wallet_customer_app_id
    and c.status = 'ACTIVE'
  for update;
  if v_wallet is null or v_wallet = v_booking then
    raise exception '顧客帳號無效';
  end if;

  select count(*) into v_existing_count
  from public.customer_wallet_identities i
  where i.organization_id = v_org
    and i.status = 'ACTIVE'
    and (
      i.booking_customer_id in (v_booking, v_wallet)
      or i.wallet_customer_id in (v_booking, v_wallet)
    );
  if v_existing_count > 0 then
    select i.id into v_existing
    from public.customer_wallet_identities i
    where i.organization_id = v_org
      and i.booking_customer_id = v_booking
      and i.wallet_customer_id = v_wallet
      and i.status = 'ACTIVE';
    if v_existing is not null and v_existing_count = 1 then
      return v_existing;
    end if;
    raise exception '顧客身分對應已存在';
  end if;

  perform 1 from public.member_line_customer_links ml
    where ml.organization_id = v_org
      and ml.customer_id = v_wallet
      and ml.verified_at is not null
    for share;
  if not found then
    perform 1 from public.line_customer_bindings b
      where b.organization_id = v_org_app
        and b.customer_uuid = v_wallet
        and b.status = 'active'
        and b.verified is true
        and b.confirmed_at is not null
        and b.bound_at is not null
        and b.unbound_at is null
        and b.blocked_at is null
        and nullif(trim(b.line_user_id_hash), '') is not null
      for share of b;
    if not found then
      raise exception '必須先完成 LINE 會員綁定';
    end if;
  end if;

  perform 1 from public.stored_value_accounts a
    where a.organization_id = v_org
      and a.customer_id = v_wallet
      and a.status = 'ACTIVE'
      and a.currency = 'TWD'
    for update;
  if not found then
    raise exception '找不到有效儲值帳戶';
  end if;

  insert into public.customer_wallet_identities (
    organization_id, booking_customer_id, wallet_customer_id,
    status, reason, confirmed_by_staff_id
  ) values (
    v_org, v_booking, v_wallet, 'ACTIVE', btrim(p_reason), v_staff
  ) returning id into v_existing;
  return v_existing;
end;
$$;

create or replace function public.revoke_customer_wallet_identity(
  p_organization_app_id text,
  p_booking_customer_app_id text,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_booking uuid;
  v_staff text;
  v_role public.staff_role;
  v_id uuid;
begin
  if auth.uid() is null or p_reason is null or char_length(btrim(p_reason)) < 8 then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  select o.id into v_org from public.organizations o where o.app_id = p_organization_app_id;
  if v_org is null then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  v_role := public.user_org_role(v_org);
  v_staff := public.current_operational_staff_id(v_org);
  if v_role is null or not public.staff_role_is_managerial(v_role) or v_staff is null then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  select c.id into v_booking
  from public.customers c
  where c.organization_id = v_org and c.app_id = p_booking_customer_app_id
  for update;
  update public.customer_wallet_identities
     set status = 'REVOKED',
         revoked_at = now(),
         revoked_by_staff_id = v_staff,
         reason = reason || ' | ' || btrim(p_reason)
   where organization_id = v_org
     and booking_customer_id = v_booking
     and status = 'ACTIVE'
  returning id into v_id;
  if v_id is null then
    raise exception '顧客帳號無效';
  end if;
  return v_id;
end;
$$;

revoke all on function public.confirm_customer_wallet_identity(text, text, text, text) from public, anon;
revoke all on function public.revoke_customer_wallet_identity(text, text, text) from public, anon;
grant execute on function public.confirm_customer_wallet_identity(text, text, text, text) to authenticated;
grant execute on function public.revoke_customer_wallet_identity(text, text, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function public.confirm_customer_wallet_identity(text, text, text, text) from service_role';
    execute 'revoke all on function public.revoke_customer_wallet_identity(text, text, text) from service_role';
  end if;
end $$;
