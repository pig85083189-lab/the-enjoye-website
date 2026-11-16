-- Finance database only (bfzquejrtgqzzarhkiya).
-- Apply inside one transaction after
-- 20261116120000_line_verified_booking_source_link.sql.
-- Replaces checkout debit and manual top-up so both use
-- customer_line_membership_is_current. Does not update or delete customers,
-- LINE bindings, appointments, receipts, or ledger rows.
-- A repeated checkout effect key returns the existing payment. A repeated
-- top-up effect key returns the existing entry. The booking database receipt
-- is a separate claim and is not written here.

do $$
begin
  if to_regprocedure('public.customer_line_membership_is_current(uuid,uuid)') is null then
    raise exception 'customer_line_membership_is_current is not installed';
  end if;
  if to_regprocedure('public.settle_booking_source_checkout(text,text,text,text,bigint,text)') is null then
    raise exception 'settle_booking_source_checkout is not installed';
  end if;
  if to_regclass('public.stored_value_ledger_entries') is null then
    raise exception 'stored_value_ledger_entries is not installed';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_stored_value_ledger_immutable'
      and tgrelid = 'public.stored_value_ledger_entries'::regclass
      and not tgisinternal
  ) then
    raise exception 'ledger immutability trigger is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_stored_value_ledger_current_line'
      and tgrelid = 'public.stored_value_ledger_entries'::regclass
      and not tgisinternal
  ) then
    raise exception 'current LINE ledger trigger is missing';
  end if;
end $$;

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
  select organization_row.id into v_org
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

  if not public.customer_line_membership_is_current(v_org, v_wallet) then
    raise exception '必須先完成 LINE 會員綁定';
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


revoke all on function public.settle_booking_source_checkout(text, text, text, text, bigint, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.customer_line_membership_is_current(uuid, uuid) to service_role';
    execute 'grant execute on function public.settle_booking_source_checkout(text, text, text, text, bigint, text) to service_role';
  end if;
end $$;


create or replace function public.post_stored_value_top_up_v1(
  p_organization_id uuid,
  p_customer_id uuid,
  p_location_id uuid,
  p_staff_id text,
  p_amount_minor bigint,
  p_effect_key text,
  p_method text
) returns table(entry_id uuid, account_id uuid, balance_minor bigint, was_duplicate boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account uuid;
  v_entry record;
  v_entry_id uuid;
  v_balance bigint;
begin
  if p_organization_id is null or p_customer_id is null or
     p_location_id is null or p_staff_id is null or
     p_amount_minor is null or p_amount_minor <= 0 or
     p_amount_minor > 100000000 or
     p_effect_key is null or length(trim(p_effect_key)) < 16 or
     length(p_effect_key) > 180 then
    raise exception 'Invalid top-up request';
  end if;
  if p_method is null or p_method not in ('CASH','CREDIT_CARD','BANK_TRANSFER','OTHER') then
    raise exception 'Invalid manual payment method';
  end if;
  if not public.is_operational_staff_id(p_staff_id) then
    raise exception 'Invalid operational staff';
  end if;

  perform 1 from public.customers
    where id = p_customer_id and organization_id = p_organization_id
      and status = 'ACTIVE'
    for update;
  if not found then raise exception 'Customer not found in organization'; end if;
  if not public.customer_line_membership_is_current(p_organization_id, p_customer_id) then
    raise exception '必須先完成 LINE 會員綁定';
  end if;
  perform 1 from public.locations
    where id = p_location_id and organization_id = p_organization_id
      and is_active = true;
  if not found then raise exception 'Invalid location'; end if;

  select e.id,e.account_id,e.customer_id,e.location_id,e.created_by_staff_id,
         e.amount_delta_minor,e.type,e.reason
    into v_entry
    from public.stored_value_ledger_entries e
   where e.organization_id = p_organization_id and e.effect_key = p_effect_key;
  if found then
    if v_entry.customer_id <> p_customer_id or
       v_entry.location_id is distinct from p_location_id or
       v_entry.created_by_staff_id <> p_staff_id or
       v_entry.amount_delta_minor <> p_amount_minor or
       v_entry.type <> 'TOP_UP'::public.stored_value_ledger_type or
       v_entry.reason is distinct from ('MANUAL_RECEIPT:' || p_method) then
      raise exception 'Idempotency key conflict';
    end if;
    select coalesce(sum(e.amount_delta_minor),0) into v_balance
      from public.stored_value_ledger_entries e
     where e.account_id = v_entry.account_id;
    return query select v_entry.id, v_entry.account_id, v_balance, true;
    return;
  end if;

  select a.id into v_account from public.stored_value_accounts a
    where a.organization_id = p_organization_id and a.customer_id = p_customer_id
      and a.status = 'ACTIVE' and a.currency = 'TWD'
    for update;
  if exists (
    select 1 from public.stored_value_accounts a
    where a.organization_id = p_organization_id
      and a.customer_id = p_customer_id
      and (a.status <> 'ACTIVE' or a.currency <> 'TWD')
  ) then
    raise exception 'Wallet is not eligible for top-up';
  end if;
  if v_account is null then
    insert into public.stored_value_accounts (organization_id,customer_id,currency,status)
      values (p_organization_id,p_customer_id,'TWD','ACTIVE')
      returning id into v_account;
  end if;

  insert into public.stored_value_ledger_entries (
    organization_id,account_id,customer_id,type,amount_delta_minor,
    location_id,created_by_staff_id,effect_key,reason
  ) values (
    p_organization_id,v_account,p_customer_id,'TOP_UP',p_amount_minor,
    p_location_id,p_staff_id,p_effect_key,'MANUAL_RECEIPT:' || p_method
  ) returning id into v_entry_id;

  select coalesce(sum(e.amount_delta_minor),0) into v_balance
    from public.stored_value_ledger_entries e where e.account_id = v_account;
  return query select v_entry_id,v_account,v_balance,false;
end;
$$;

revoke all on function public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text) to service_role';
  end if;
end $$;
