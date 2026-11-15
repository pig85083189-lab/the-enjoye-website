-- Booking-database customer key to the finance booking customer.
-- Apply on the finance database only. Does not update or delete ledger rows,
-- customers, appointments, or customer_wallet_identities.
-- A link is written only after a managerial staff session is verified.
-- The function identifies the finance customer by app id inside one organization.

create table if not exists public.customer_wallet_identities_backup_20261115
  (like public.customer_wallet_identities);

insert into public.customer_wallet_identities_backup_20261115
select source_row.*
from public.customer_wallet_identities source_row
where not exists (
  select 1
  from public.customer_wallet_identities_backup_20261115 backup_row
  where backup_row.id = source_row.id
);

revoke all on public.customer_wallet_identities_backup_20261115 from public, anon, authenticated;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  app_id text,
  name text not null default 'location',
  is_active boolean not null default true
);

create table if not exists public.booking_source_customer_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  source_customer_key text not null,
  finance_booking_customer_id uuid not null references public.customers (id) on delete restrict,
  evidence_kind text not null,
  reason text not null,
  confirmed_by_staff_id text not null,
  confirmed_by_auth_user_id uuid not null,
  confirmed_at timestamptz not null default now(),
  status text not null default 'ACTIVE',
  revoked_at timestamptz,
  revoked_by_staff_id text,
  constraint booking_source_customer_links_key check (
    char_length(btrim(source_customer_key)) between 8 and 120
  ),
  constraint booking_source_customer_links_evidence check (
    evidence_kind in ('CUSTOMER_PRESENT', 'TRUSTED_MEMBER_RECORD')
  ),
  constraint booking_source_customer_links_reason check (char_length(btrim(reason)) between 8 and 200),
  constraint booking_source_customer_links_status check (status in ('ACTIVE', 'REVOKED')),
  constraint booking_source_customer_links_staff check (public.is_operational_staff_id(confirmed_by_staff_id)),
  constraint booking_source_customer_links_revoked_staff check (
    revoked_by_staff_id is null or public.is_operational_staff_id(revoked_by_staff_id)
  )
);

create unique index if not exists booking_source_customer_links_active_key
  on public.booking_source_customer_links (organization_id, source_customer_key)
  where status = 'ACTIVE';

create unique index if not exists booking_source_customer_links_active_finance
  on public.booking_source_customer_links (organization_id, finance_booking_customer_id)
  where status = 'ACTIVE';

create or replace function public.booking_source_customer_links_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.customers customer_row
    where customer_row.id = new.finance_booking_customer_id
      and customer_row.organization_id = new.organization_id
  ) then
    raise exception '顧客帳號無效';
  end if;
  if exists (
    select 1
    from public.customers customer_row
    where customer_row.organization_id = new.organization_id
      and customer_row.id <> new.finance_booking_customer_id
      and (
        customer_row.app_id = btrim(new.source_customer_key)
        or customer_row.id::text = btrim(new.source_customer_key)
      )
  ) then
    raise exception '顧客帳號無效';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_booking_source_customer_links_guard on public.booking_source_customer_links;
create trigger trg_booking_source_customer_links_guard
before insert or update on public.booking_source_customer_links
for each row execute function public.booking_source_customer_links_guard();

alter table public.booking_source_customer_links enable row level security;

drop policy if exists booking_source_customer_links_select_org on public.booking_source_customer_links;
create policy booking_source_customer_links_select_org
  on public.booking_source_customer_links
  for select to authenticated
  using (public.user_has_org_membership(organization_id));

revoke all on public.booking_source_customer_links from public, anon, authenticated;
grant select on public.booking_source_customer_links to authenticated;

create or replace function public.assert_booking_source_actor(
  p_organization_id uuid,
  p_staff_id text,
  p_checkout boolean
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.staff_role;
  v_staff text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    if p_staff_id is null or not public.is_operational_staff_id(p_staff_id) then
      raise exception '沒有權限結帳';
    end if;
    return p_staff_id;
  end if;
  if auth.uid() is null then
    raise exception '沒有權限結帳';
  end if;
  v_role := public.user_org_role(p_organization_id);
  v_staff := public.current_operational_staff_id(p_organization_id);
  if v_role is null or v_staff is null or v_staff is distinct from p_staff_id then
    raise exception '沒有權限結帳';
  end if;
  if p_checkout then
    if v_role not in ('OWNER', 'MANAGER', 'STAFF', 'RECEPTIONIST') then
      raise exception '沒有權限結帳';
    end if;
  elsif not public.staff_role_is_managerial(v_role) then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  return v_staff;
end;
$$;

create or replace function public.confirm_booking_source_customer_link(
  p_organization_app_id text,
  p_source_customer_key text,
  p_finance_booking_customer_app_id text,
  p_evidence_kind text,
  p_reason text,
  p_confirmed_by_auth_user_id uuid,
  p_confirmed_by_staff_id text
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
  v_existing uuid;
begin
  if p_confirmed_by_auth_user_id is null then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  if p_evidence_kind not in ('CUSTOMER_PRESENT', 'TRUSTED_MEMBER_RECORD') then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 8 or char_length(p_reason) > 200 then
    raise exception '請填寫身分對應原因';
  end if;
  if p_source_customer_key is null or char_length(btrim(p_source_customer_key)) < 8
     or char_length(p_source_customer_key) > 120
     or p_finance_booking_customer_app_id is null
     or btrim(p_finance_booking_customer_app_id) = '' then
    raise exception '顧客帳號無效';
  end if;
  if btrim(p_source_customer_key) = btrim(p_finance_booking_customer_app_id) then
    raise exception '顧客帳號無效';
  end if;

  select organization_row.id, organization_row.app_id
    into v_org, v_org_app
  from public.organizations organization_row
  where organization_row.app_id = p_organization_app_id;
  if v_org is null then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    v_staff := public.assert_booking_source_actor(v_org, p_confirmed_by_staff_id, false);
  else
    v_staff := public.assert_booking_source_actor(v_org, p_confirmed_by_staff_id, false);
    if p_confirmed_by_auth_user_id is distinct from auth.uid() then
      raise exception '沒有權限建立顧客身分對應';
    end if;
  end if;

  select customer_row.id into v_booking
  from public.customers customer_row
  where customer_row.organization_id = v_org
    and customer_row.app_id = btrim(p_finance_booking_customer_app_id)
    and customer_row.status = 'ACTIVE'
  for update;
  if v_booking is null then
    raise exception '顧客帳號無效';
  end if;

  select identity_row.wallet_customer_id into v_wallet
  from public.customer_wallet_identities identity_row
  where identity_row.organization_id = v_org
    and identity_row.booking_customer_id = v_booking
    and identity_row.status = 'ACTIVE'
  for update;
  if v_wallet is null then
    raise exception '顧客帳號無效';
  end if;

  perform 1 from public.member_line_customer_links line_link
    where line_link.organization_id = v_org
      and line_link.customer_id = v_wallet
      and line_link.verified_at is not null
    for share;
  if not found then
    perform 1 from public.line_customer_bindings binding_row
      where binding_row.organization_id = v_org_app
        and binding_row.customer_uuid = v_wallet
        and binding_row.status = 'active'
        and binding_row.verified is true
        and binding_row.confirmed_at is not null
        and binding_row.bound_at is not null
        and binding_row.unbound_at is null
        and binding_row.blocked_at is null
        and nullif(trim(binding_row.line_user_id_hash), '') is not null
      for share of binding_row;
    if not found then
      raise exception '必須先完成 LINE 會員綁定';
    end if;
  end if;

  perform 1 from public.stored_value_accounts account_row
    where account_row.organization_id = v_org
      and account_row.customer_id = v_wallet
      and account_row.status = 'ACTIVE'
      and account_row.currency = 'TWD'
    for update;
  if not found then
    raise exception '找不到有效儲值帳戶';
  end if;

  select link_row.id into v_existing
  from public.booking_source_customer_links link_row
  where link_row.organization_id = v_org
    and link_row.source_customer_key = btrim(p_source_customer_key)
    and link_row.finance_booking_customer_id = v_booking
    and link_row.status = 'ACTIVE';
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.booking_source_customer_links (
    organization_id,
    source_customer_key,
    finance_booking_customer_id,
    evidence_kind,
    reason,
    confirmed_by_staff_id,
    confirmed_by_auth_user_id
  ) values (
    v_org,
    btrim(p_source_customer_key),
    v_booking,
    p_evidence_kind,
    btrim(p_reason),
    v_staff,
    p_confirmed_by_auth_user_id
  ) returning id into v_existing;
  return v_existing;
end;
$$;

create or replace function public.resolve_booking_source_customer(
  p_organization_id uuid,
  p_source_customer_key text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking uuid;
begin
  select link_row.finance_booking_customer_id into v_booking
  from public.booking_source_customer_links link_row
  where link_row.organization_id = p_organization_id
    and link_row.source_customer_key = btrim(p_source_customer_key)
    and link_row.status = 'ACTIVE'
    and link_row.evidence_kind in ('CUSTOMER_PRESENT', 'TRUSTED_MEMBER_RECORD')
  for update;
  if v_booking is null then
    raise exception '必須先完成顧客身分對應';
  end if;
  return v_booking;
end;
$$;

create or replace function public.open_booking_source_checkout(
  p_organization_app_id text,
  p_source_customer_key text,
  p_checkout_app_id text,
  p_location_app_id text,
  p_amount bigint,
  p_staff_id text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_booking uuid;
  v_location uuid;
  v_draft uuid;
  v_app text;
begin
  if p_checkout_app_id is null or char_length(btrim(p_checkout_app_id)) < 4
     or char_length(p_checkout_app_id) > 80 or p_amount is null or p_amount < 0 then
    raise exception '找不到結帳資料';
  end if;
  select organization_row.id into v_org
  from public.organizations organization_row
  where organization_row.app_id = p_organization_app_id;
  if v_org is null then
    raise exception '沒有權限結帳';
  end if;
  perform public.assert_booking_source_actor(v_org, p_staff_id, true);
  v_booking := public.resolve_booking_source_customer(v_org, p_source_customer_key);
  if p_location_app_id is not null and btrim(p_location_app_id) <> '' then
    select location_row.id into v_location
    from public.locations location_row
    where location_row.organization_id = v_org
      and location_row.app_id = p_location_app_id
      and location_row.is_active
    limit 1;
  end if;
  if v_location is null
     and (select count(*) from public.locations location_row
          where location_row.organization_id = v_org and location_row.is_active) = 1 then
    select location_row.id into v_location
    from public.locations location_row
    where location_row.organization_id = v_org
      and location_row.is_active;
  end if;
  if v_location is null then
    raise exception '找不到結帳資料';
  end if;
  v_app := 'src-' || btrim(p_checkout_app_id);
  select draft_row.id into v_draft
  from public.checkout_drafts draft_row
  where draft_row.organization_id = v_org
    and draft_row.app_id = v_app
  for update;
  if v_draft is not null then
    if (select customer_id from public.checkout_drafts where id = v_draft) is distinct from v_booking then
      raise exception '顧客帳號無效';
    end if;
    return v_draft;
  end if;
  insert into public.checkout_drafts (
    organization_id, location_id, customer_id, app_id,
    subtotal_minor, discount_total_minor, total_minor, currency, status,
    created_by_staff_id, updated_at
  ) values (
    v_org, v_location, v_booking, v_app,
    p_amount, 0, p_amount, 'TWD', 'OPEN',
    p_staff_id, now()
  ) returning id into v_draft;
  insert into public.checkout_items (
    organization_id, checkout_draft_id, app_id, type, name_snapshot,
    unit_price_minor, quantity, line_subtotal_minor, discount_amount_minor,
    line_total_minor, sort_order
  ) values (
    v_org, v_draft, v_app || '-item', 'SERVICE', '結帳服務',
    p_amount, 1, p_amount, 0, p_amount, 0
  );
  return v_draft;
exception
  when unique_violation then
    select draft_row.id into v_draft
    from public.checkout_drafts draft_row
    where draft_row.organization_id = v_org
      and draft_row.app_id = v_app
      and draft_row.customer_id = v_booking;
    if v_draft is null then
      raise exception '顧客帳號無效';
    end if;
    return v_draft;
end;
$$;

create or replace function public.save_booking_source_checkout(
  p_organization_app_id text,
  p_source_customer_key text,
  p_checkout_app_id text,
  p_location_app_id text,
  p_amount bigint,
  p_staff_id text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft uuid;
  v_org uuid;
  v_booking uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception '付款金額不可為 0';
  end if;
  v_draft := public.open_booking_source_checkout(
    p_organization_app_id, p_source_customer_key, p_checkout_app_id,
    p_location_app_id, p_amount, p_staff_id
  );
  select organization_row.id into v_org
  from public.organizations organization_row
  where organization_row.app_id = p_organization_app_id;
  v_booking := public.resolve_booking_source_customer(v_org, p_source_customer_key);
  if (select customer_id from public.checkout_drafts where id = v_draft) is distinct from v_booking then
    raise exception '顧客帳號無效';
  end if;
  if (select status from public.checkout_drafts where id = v_draft) not in ('OPEN', 'READY') then
    raise exception '已完成的結帳不能再修改';
  end if;
  update public.checkout_drafts
     set subtotal_minor = p_amount,
         discount_total_minor = 0,
         total_minor = p_amount,
         updated_at = now()
   where id = v_draft;
  update public.checkout_items
     set unit_price_minor = p_amount,
         line_subtotal_minor = p_amount,
         line_total_minor = p_amount
   where checkout_draft_id = v_draft;
  delete from public.checkout_payments where checkout_draft_id = v_draft;
  insert into public.checkout_payments (
    organization_id, checkout_draft_id, app_id, method, amount_minor
  ) values (
    v_org, v_draft, 'src-pay-' || btrim(p_checkout_app_id), 'STORED_VALUE', p_amount
  );
  return v_draft;
end;
$$;

create or replace function public.settle_booking_source_checkout(
  p_organization_app_id text,
  p_source_customer_key text,
  p_checkout_app_id text,
  p_location_app_id text,
  p_amount bigint,
  p_staff_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_booking uuid;
  v_wallet uuid;
  v_org_app text;
  v_account uuid;
  v_draft uuid;
  v_tx uuid;
  v_staff text;
  v_balance bigint;
  v_effect text;
  v_existing_amount bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception '儲值金扣款金額必須大於零';
  end if;
  select organization_row.id, organization_row.app_id into v_org, v_org_app
  from public.organizations organization_row
  where organization_row.app_id = p_organization_app_id;
  if v_org is null then
    raise exception '沒有權限結帳';
  end if;
  v_staff := public.assert_booking_source_actor(v_org, p_staff_id, true);
  v_booking := public.resolve_booking_source_customer(v_org, p_source_customer_key);
  select identity_row.wallet_customer_id into v_wallet
  from public.customer_wallet_identities identity_row
  where identity_row.organization_id = v_org
    and identity_row.booking_customer_id = v_booking
    and identity_row.status = 'ACTIVE'
  for update;
  if v_wallet is null or v_wallet = v_booking then
    raise exception '必須先完成顧客身分對應';
  end if;
  if (select status from public.customers where id = v_wallet and organization_id = v_org) is distinct from 'ACTIVE' then
    raise exception '顧客帳號無效';
  end if;

  perform 1 from public.member_line_customer_links line_link
    where line_link.organization_id = v_org
      and line_link.customer_id = v_wallet
      and line_link.verified_at is not null
    for share;
  if not found then
    perform 1 from public.line_customer_bindings binding_row
      where binding_row.organization_id = v_org_app
        and binding_row.customer_uuid = v_wallet
        and binding_row.status = 'active'
        and binding_row.verified is true
        and binding_row.confirmed_at is not null
        and binding_row.bound_at is not null
        and binding_row.unbound_at is null
        and binding_row.blocked_at is null
        and nullif(trim(binding_row.line_user_id_hash), '') is not null
      for share of binding_row;
    if not found then
      raise exception '必須先完成 LINE 會員綁定';
    end if;
  end if;

  select account_row.id into v_account
  from public.stored_value_accounts account_row
  where account_row.organization_id = v_org
    and account_row.customer_id = v_wallet
    and account_row.status = 'ACTIVE'
    and account_row.currency = 'TWD'
  for update;
  if v_account is null then
    raise exception '找不到有效儲值帳戶';
  end if;

  v_effect := 'booking-checkout:' || btrim(p_checkout_app_id);
  select -amount_delta_minor into v_existing_amount
  from public.stored_value_ledger_entries
  where organization_id = v_org
    and effect_key = v_effect
    and type = 'PAYMENT'
  for update;
  if v_existing_amount is not null then
    if v_existing_amount is distinct from p_amount then
      raise exception '儲值金扣款未入帳，請勿重複結帳';
    end if;
    select coalesce(sum(amount_delta_minor), 0) into v_balance
    from public.stored_value_ledger_entries
    where account_id = v_account;
    return jsonb_build_object(
      'effectKey', v_effect,
      'balanceMinor', v_balance,
      'replayed', true
    );
  end if;

  v_draft := public.save_booking_source_checkout(
    p_organization_app_id, p_source_customer_key, p_checkout_app_id,
    p_location_app_id, p_amount, p_staff_id
  );
  insert into public.transactions (
    organization_id, location_id, customer_id, checkout_draft_id, app_id,
    transaction_number, status, subtotal_minor, discount_total_minor, total_minor,
    currency, created_by_staff_id, completed_at
  )
  select
    draft_row.organization_id, draft_row.location_id, draft_row.customer_id, draft_row.id,
    'stx-' || btrim(p_checkout_app_id),
    public.next_transaction_number(v_org, now()),
    'COMPLETED', p_amount, 0, p_amount, 'TWD', v_staff, now()
  from public.checkout_drafts draft_row
  where draft_row.id = v_draft
  returning id into v_tx;

  insert into public.stored_value_ledger_entries (
    organization_id, account_id, customer_id, type, amount_delta_minor,
    transaction_id, location_id, reason, effect_key, created_by_staff_id
  )
  select
    v_org, v_account, v_wallet, 'PAYMENT', -p_amount,
    v_tx, draft_row.location_id, 'CHECKOUT', v_effect, v_staff
  from public.checkout_drafts draft_row
  where draft_row.id = v_draft;

  select coalesce(sum(amount_delta_minor), 0) into v_balance
  from public.stored_value_ledger_entries
  where account_id = v_account;
  if v_balance < 0 then
    raise exception '儲值金餘額不足';
  end if;

  update public.checkout_drafts
     set status = 'COMPLETED', updated_at = now()
   where id = v_draft
     and customer_id = v_booking;
  return jsonb_build_object(
    'effectKey', v_effect,
    'balanceMinor', v_balance,
    'replayed', false
  );
end;
$$;

revoke all on function public.assert_booking_source_actor(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.confirm_booking_source_customer_link(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_booking_source_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.open_booking_source_checkout(text, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.save_booking_source_checkout(text, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.settle_booking_source_checkout(text, text, text, text, bigint, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.confirm_booking_source_customer_link(text, text, text, text, text, uuid, text) to service_role';
    execute 'grant execute on function public.open_booking_source_checkout(text, text, text, text, bigint, text) to service_role';
    execute 'grant execute on function public.save_booking_source_checkout(text, text, text, text, bigint, text) to service_role';
    execute 'grant execute on function public.settle_booking_source_checkout(text, text, text, text, bigint, text) to service_role';
    execute 'grant select on public.booking_source_customer_links to service_role';
  end if;
end $$;
