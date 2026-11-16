-- Production catalog snapshot: finance bfzquejrtgqzzarhkiya, 2026-11-16.
-- Read-only extracted function definitions and grants. No customer or ledger data.
-- Apply only as a reviewed rollback, never as a deployment migration.

CREATE OR REPLACE FUNCTION public.post_stored_value_top_up_v1(p_organization_id uuid, p_customer_id uuid, p_location_id uuid, p_staff_id text, p_amount_minor bigint, p_effect_key text, p_method text)
 RETURNS TABLE(entry_id uuid, account_id uuid, balance_minor bigint, was_duplicate boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  -- Format check only: authenticated membership/checkout authority must be checked by API.
  if p_method is null or p_method not in ('CASH','CREDIT_CARD','BANK_TRANSFER','OTHER') then
    raise exception 'Invalid manual payment method';
  end if;
  if not public.is_operational_staff_id(p_staff_id) then
    raise exception 'Invalid operational staff';
  end if;

  -- Serialize all top-ups per customer, including retries before account creation.
  perform 1 from public.customers
    where id = p_customer_id and organization_id = p_organization_id
      and status = 'ACTIVE'
    for update;
  if not found then raise exception 'Customer not found in organization'; end if;
  -- Fail closed unless this canonical customer has a verified, confirmed LINE binding.
  perform 1 from public.line_customer_bindings b
    join public.organizations o on o.app_id = b.organization_id
   where o.id = p_organization_id
     and b.customer_uuid = p_customer_id
     and b.status = 'active'
     and b.verified is true
     and b.confirmed_at is not null
     and b.bound_at is not null
     and b.unbound_at is null
     and b.blocked_at is null
     and nullif(trim(b.line_user_id_hash), '') is not null
    for share of b;
  if not found and not exists (select 1 from public.member_line_customer_links ml join public.customers mc on mc.id=ml.customer_id and mc.organization_id=ml.organization_id and mc.status='ACTIVE' where ml.organization_id=p_organization_id and ml.customer_id=p_customer_id and ml.verified_at is not null) then raise exception 'LINE member binding required for top-up'; end if;
  perform 1 from public.locations
    where id = p_location_id and organization_id = p_organization_id
      and is_active = true;
  if not found then raise exception 'Invalid location'; end if;

  -- A reused effect key with different parameters must never silently succeed.
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
  -- A suspended or closed wallet must not be silently replaced with a new active wallet.
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
$function$
;
REVOKE ALL ON FUNCTION public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_booking_source_checkout(p_organization_app_id text, p_source_customer_key text, p_checkout_app_id text, p_location_app_id text, p_amount bigint, p_staff_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
REVOKE ALL ON FUNCTION public.settle_booking_source_checkout(text,text,text,text,bigint,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_booking_source_checkout(text,text,text,text,bigint,text) TO service_role;

DROP TRIGGER IF EXISTS trg_stored_value_ledger_immutable ON public.stored_value_ledger_entries;
CREATE TRIGGER trg_stored_value_ledger_immutable BEFORE DELETE OR UPDATE ON public.stored_value_ledger_entries FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
-- Objects introduced by the release. Dropping them does not delete ledger rows.
DROP TRIGGER IF EXISTS trg_stored_value_ledger_current_line ON public.stored_value_ledger_entries;
DROP FUNCTION IF EXISTS public.stored_value_ledger_requires_current_line_membership();
DROP FUNCTION IF EXISTS public.customer_line_membership_is_current(uuid, uuid);
DROP FUNCTION IF EXISTS public.link_booking_source_from_verified_line(text, text, text, uuid);
DROP FUNCTION IF EXISTS public.decide_member_binding_request(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.current_line_subject_customers(uuid, text, text);
DROP FUNCTION IF EXISTS public.enqueue_member_binding_review(uuid, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.line_binding_customer_in_org(uuid, jsonb);
DROP FUNCTION IF EXISTS public.line_binding_resolved_customer_id(jsonb);
