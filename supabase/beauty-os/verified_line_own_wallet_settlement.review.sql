-- REVIEW ONLY. Not applied to any database. Requires isolated tests.
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
  v_account uuid;
  v_draft uuid;
  v_tx uuid;
  v_staff text;
  v_balance bigint;
  v_effect text;
  v_existing_amount bigint;
  v_line_hash text;
  v_line_customer uuid;
  v_line_count integer;
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
  -- Existing wallet mappings remain authoritative. No synthetic identity rows.
  if v_wallet is null then
    select min(lower(btrim(ml.line_subject_hash))) into v_line_hash
    from public.member_line_customer_links ml
    where ml.organization_id = v_org and ml.customer_id = v_booking
      and ml.verified_at is not null
      and lower(btrim(ml.line_subject_hash)) ~ '^[0-9a-f]{64}
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
$function$
;
    if v_line_hash is not null
      and (select count(*) from public.member_line_customer_links ml
           where ml.organization_id = v_org and ml.customer_id = v_booking) = 1
      and (select count(*) from public.member_line_customer_links ml
           where ml.organization_id = v_org and lower(btrim(ml.line_subject_hash)) = v_line_hash) = 1
      and exists (
        select 1 from public.booking_source_customer_links l
        where l.organization_id = v_org and l.source_customer_key = btrim(p_source_customer_key)
          and l.finance_booking_customer_id = v_booking
          and l.status = 'ACTIVE' and l.revoked_at is null
          and l.evidence_kind = 'LINE_VERIFIED_SESSION'
      )
      and not exists (
        select 1 from public.customer_wallet_identities i
        where i.organization_id = v_org
          and (i.booking_customer_id = v_booking or i.wallet_customer_id = v_booking)
      )
      and not exists (
        select 1 from public.booking_source_customer_links l
        where l.organization_id = v_org and l.finance_booking_customer_id = v_booking
          and l.source_customer_key <> btrim(p_source_customer_key)
      )
      and public.customer_line_membership_is_current(v_org, v_booking)
    then
      select count(*), min(subject.customer_id) into v_line_count, v_line_customer
      from public.current_line_subject_customers(v_org, p_organization_app_id, v_line_hash) subject;
      if v_line_count = 1 and v_line_customer = v_booking then
        v_wallet := v_booking;
      end if;
    end if;
  end if;
  if v_wallet is null then
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
$function$

