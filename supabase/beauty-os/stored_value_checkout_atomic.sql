-- Beauty OS checkout debit for canonical stored-value accounts.
-- Reviewed from stored_value_checkout_atomic.review.sql. Do not apply that review file.
-- PACKAGE stays closed. STORED_VALUE debits stored_value_ledger_entries in the same
-- transaction as the checkout. effect_key checkout:<draft uuid> is unique per organization.
-- Lock order matches top-up: customer row, LINE binding, then the wallet row.
-- A completed checkout without its PAYMENT row fails closed instead of reporting success.
-- Run supabase/tests/stored-value-checkout-atomic.local-cases.sql on an empty local database
-- before applying this file. Never point that test at a customer database.

CREATE OR REPLACE FUNCTION public.save_checkout_draft(p_checkout_app_id text, p_expected_updated_at timestamp with time zone, p_payments jsonb, p_discounts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_draft public.checkout_drafts;
  v_staff_id text;
  v_payment jsonb;
  v_discount jsonb;
  v_subtotal bigint := 0;
  v_line_discount bigint := 0;
  v_remaining bigint;
  v_discount_total bigint;
  v_amount bigint;
begin
  if auth.uid() is null then
    raise exception '沒有權限結帳';
  end if;

  select * into v_draft
  from public.checkout_drafts
  where app_id = p_checkout_app_id
  for update;
  if v_draft.id is null then
    raise exception '找不到結帳資料';
  end if;

  v_staff_id := public.assert_commerce_checkout_actor(v_draft.organization_id, v_draft.location_id);
  if v_draft.status not in ('OPEN', 'READY') then
    raise exception '已完成的結帳不能再修改';
  end if;
  if v_draft.updated_at is distinct from p_expected_updated_at then
    raise exception '資料已更新，請重新整理後再試';
  end if;

  select
    coalesce(sum(line_subtotal_minor), 0),
    coalesce(sum(discount_amount_minor), 0)
  into v_subtotal, v_line_discount
  from public.checkout_items
  where checkout_draft_id = v_draft.id;

  v_remaining := v_subtotal - v_line_discount;
  v_discount_total := v_line_discount;

  delete from public.checkout_payments where checkout_draft_id = v_draft.id;
  delete from public.checkout_discounts where checkout_draft_id = v_draft.id;

  if p_discounts is not null then
    for v_discount in select value from jsonb_array_elements(p_discounts)
    loop
      v_amount := public.checkout_discount_amount(
        v_subtotal,
        v_remaining,
        (v_discount->>'type')::public.discount_type,
        coalesce((v_discount->>'value')::bigint, 0)
      );
      v_discount_total := v_discount_total + v_amount;
      v_remaining := v_remaining - v_amount;
      insert into public.checkout_discounts (
        organization_id,
        checkout_draft_id,
        app_id,
        type,
        value,
        label,
        reason,
        created_by_staff_id
      ) values (
        v_draft.organization_id,
        v_draft.id,
        coalesce(v_discount->>'id', 'cds-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14)),
        (v_discount->>'type')::public.discount_type,
        coalesce((v_discount->>'value')::bigint, 0),
        v_discount->>'label',
        v_discount->>'reason',
        v_staff_id
      );
    end loop;
  end if;

  if p_payments is not null then
    for v_payment in select value from jsonb_array_elements(p_payments)
    loop
      if coalesce(v_payment->>'method', '') = 'PACKAGE' then
        raise exception '此付款方式目前尚未開放';
      end if;
      if coalesce((v_payment->>'amount')::bigint, 0) <= 0 then
        raise exception '付款金額不可為 0';
      end if;
      insert into public.checkout_payments (
        organization_id,
        checkout_draft_id,
        app_id,
        method,
        amount_minor,
        reference,
        note
      ) values (
        v_draft.organization_id,
        v_draft.id,
        coalesce(v_payment->>'id', 'pay-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14)),
        (v_payment->>'method')::public.payment_method,
        (v_payment->>'amount')::bigint,
        v_payment->>'reference',
        v_payment->>'note'
      );
    end loop;
  end if;

  update public.checkout_drafts
  set
    subtotal_minor = v_subtotal,
    discount_total_minor = v_discount_total,
    total_minor = v_subtotal - v_discount_total,
    updated_at = now()
  where id = v_draft.id
  returning * into v_draft;

  return public.commerce_checkout_bundle(v_draft);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.settle_checkout_draft(p_checkout_app_id text, p_expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_draft public.checkout_drafts;
  v_staff_id text;
  v_apt public.appointments;
  v_trt public.treatments;
  v_tx public.transactions;
  v_now timestamptz := now();
  v_pay_sum bigint := 0;
  v_tx_app text;
  v_item public.checkout_items;
  v_discount public.checkout_discounts;
  v_payment public.checkout_payments;
  v_subtotal bigint := 0;
  v_line_discount bigint := 0;
  v_remaining bigint;
  v_discount_total bigint;
  v_amount bigint;
  v_wallet public.stored_value_accounts;
  v_wallet_balance bigint;
  v_wallet_charge bigint := 0;
begin
  if auth.uid() is null then
    raise exception '沒有權限結帳';
  end if;

  select * into v_draft
  from public.checkout_drafts
  where app_id = p_checkout_app_id
  for update;
  if v_draft.id is null then
    raise exception '找不到結帳資料';
  end if;

  v_staff_id := public.assert_commerce_checkout_actor(v_draft.organization_id, v_draft.location_id);

  if v_draft.status = 'COMPLETED' then
    select * into v_tx
    from public.transactions
    where organization_id = v_draft.organization_id
      and checkout_draft_id = v_draft.id
      and status = 'COMPLETED'
    limit 1;
    if v_tx.id is null then
      raise exception '結帳已完成，但找不到交易';
    end if;
    select coalesce(sum(amount_minor), 0) into v_wallet_charge
    from public.checkout_payments
    where checkout_draft_id = v_draft.id
      and method = 'STORED_VALUE';
    if v_wallet_charge > 0 and not exists (
      select 1
      from public.stored_value_ledger_entries e
      where e.organization_id = v_draft.organization_id
        and e.effect_key = 'checkout:' || v_draft.id::text
        and e.type = 'PAYMENT'
        and e.amount_delta_minor = -v_wallet_charge
        and e.customer_id = v_draft.customer_id
        and e.transaction_id = v_tx.id
    ) then
      raise exception '儲值金扣款未入帳，請勿重複結帳';
    end if;
    return public.commerce_checkout_bundle(v_draft);
  end if;
  if v_draft.status not in ('OPEN', 'READY') then
    raise exception '結帳狀態無法收款';
  end if;
  if v_draft.updated_at is distinct from p_expected_updated_at then
    raise exception '資料已更新，請重新整理後再試';
  end if;

  if v_draft.appointment_id is not null then
    select * into v_apt from public.appointments where id = v_draft.appointment_id for update;
    if v_apt.id is null or v_apt.organization_id is distinct from v_draft.organization_id then
      raise exception '沒有權限結帳';
    end if;
    if v_apt.status in ('CANCELLED', 'NO_SHOW', 'DRAFT') then
      raise exception '此預約無法結帳';
    end if;
  end if;

  if v_draft.treatment_id is not null then
    select * into v_trt from public.treatments where id = v_draft.treatment_id;
    if v_trt.id is null or v_trt.status <> 'COMPLETED' then
      raise exception '療程尚未完成，無法結帳';
    end if;
    if v_trt.organization_id is distinct from v_draft.organization_id then
      raise exception '沒有權限結帳';
    end if;
  end if;

  select * into v_tx
  from public.transactions
  where organization_id = v_draft.organization_id
    and status = 'COMPLETED'
    and (
      checkout_draft_id = v_draft.id
      or (v_draft.appointment_id is not null and appointment_id = v_draft.appointment_id)
    )
  limit 1
  for update;
  if v_tx.id is not null then
    -- Never report this draft as settled using a different appointment transaction.
    -- That would mark the checkout complete without posting its stored-value debit.
    if v_tx.checkout_draft_id is distinct from v_draft.id then
      raise exception '此預約已有其他結帳交易，請先核對交易紀錄';
    end if;
    select coalesce(sum(amount_minor), 0) into v_wallet_charge
    from public.checkout_payments
    where checkout_draft_id = v_draft.id
      and method = 'STORED_VALUE';
    if v_wallet_charge > 0 and not exists (
      select 1
      from public.stored_value_ledger_entries e
      where e.organization_id = v_draft.organization_id
        and e.effect_key = 'checkout:' || v_draft.id::text
        and e.type = 'PAYMENT'
        and e.amount_delta_minor = -v_wallet_charge
        and e.customer_id = v_draft.customer_id
        and e.transaction_id = v_tx.id
    ) then
      raise exception '儲值金扣款未入帳，請勿重複結帳';
    end if;
    update public.checkout_drafts
    set status = 'COMPLETED', updated_at = v_now
    where id = v_draft.id
    returning * into v_draft;
    return public.commerce_checkout_bundle(v_draft);
  end if;

  select
    coalesce(sum(line_subtotal_minor), 0),
    coalesce(sum(discount_amount_minor), 0)
  into v_subtotal, v_line_discount
  from public.checkout_items
  where checkout_draft_id = v_draft.id;
  if v_subtotal is null or not exists (
    select 1 from public.checkout_items where checkout_draft_id = v_draft.id
  ) then
    raise exception '結帳至少需要一個項目';
  end if;

  v_remaining := v_subtotal - v_line_discount;
  v_discount_total := v_line_discount;
  for v_discount in
    select * from public.checkout_discounts where checkout_draft_id = v_draft.id
  loop
    v_amount := public.checkout_discount_amount(
      v_subtotal,
      v_remaining,
      v_discount.type,
      v_discount.value
    );
    v_discount_total := v_discount_total + v_amount;
    v_remaining := v_remaining - v_amount;
  end loop;

  select coalesce(sum(amount_minor), 0) into v_pay_sum
  from public.checkout_payments
  where checkout_draft_id = v_draft.id;

  if (v_subtotal - v_discount_total) = 0 then
    if v_pay_sum <> 0 then
      raise exception '付款金額與應收不符';
    end if;
  elsif v_pay_sum <> (v_subtotal - v_discount_total) then
    raise exception '付款金額與應收不符';
  elsif v_pay_sum = 0 then
    raise exception '付款金額與應收不符';
  end if;

  if exists (select 1 from public.checkout_payments where checkout_draft_id=v_draft.id and method='PACKAGE') then
    raise exception '此付款方式目前尚未開放';
  end if;
  select coalesce(sum(amount_minor),0) into v_wallet_charge from public.checkout_payments
    where checkout_draft_id=v_draft.id and method='STORED_VALUE';
  -- Fail closed on zero/negative wallet rows and conflicting duplicate payment components.
  if exists (select 1 from public.checkout_payments where checkout_draft_id=v_draft.id and method='STORED_VALUE' and amount_minor<=0) then
    raise exception '儲值金扣款金額必須大於零';
  end if;
  if v_wallet_charge > 0 then
    if v_draft.currency <> 'TWD' then
      raise exception '儲值金僅支援 TWD 結帳';
    end if;
    perform 1 from public.customers where id=v_draft.customer_id and organization_id=v_draft.organization_id and status='ACTIVE' for update;
    if not found then raise exception '顧客帳號無效'; end if;
    -- Same lock order as top-up: customer row, then binding, then wallet.
    perform 1 from public.member_line_customer_links ml
      where ml.organization_id = v_draft.organization_id
        and ml.customer_id = v_draft.customer_id
        and ml.verified_at is not null
      for share;
    if not found then
      perform 1 from public.line_customer_bindings b
        join public.organizations o on o.app_id = b.organization_id
       where o.id = v_draft.organization_id
         and b.customer_uuid = v_draft.customer_id
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
    select * into v_wallet from public.stored_value_accounts where organization_id=v_draft.organization_id and customer_id=v_draft.customer_id and status='ACTIVE' and currency='TWD' for update;
    if v_wallet.id is null then raise exception '找不到有效儲值帳戶'; end if;
    select coalesce(sum(amount_delta_minor),0) into v_wallet_balance from public.stored_value_ledger_entries where account_id=v_wallet.id;
    if v_wallet_balance<v_wallet_charge then raise exception '儲值金餘額不足'; end if;
  end if;

  v_tx_app := 'tx-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14);
  insert into public.transactions (
    organization_id,
    location_id,
    customer_id,
    appointment_id,
    treatment_id,
    checkout_draft_id,
    app_id,
    transaction_number,
    status,
    subtotal_minor,
    discount_total_minor,
    total_minor,
    currency,
    created_by_staff_id,
    completed_at
  ) values (
    v_draft.organization_id,
    v_draft.location_id,
    v_draft.customer_id,
    v_draft.appointment_id,
    v_draft.treatment_id,
    v_draft.id,
    v_tx_app,
    public.next_transaction_number(v_draft.organization_id, v_now),
    'COMPLETED',
    v_subtotal,
    v_discount_total,
    v_subtotal - v_discount_total,
    v_draft.currency,
    v_staff_id,
    v_now
  )
  returning * into v_tx;

  for v_item in
    select * from public.checkout_items
    where checkout_draft_id = v_draft.id
    order by sort_order
  loop
    insert into public.transaction_items (
      organization_id,
      transaction_id,
      app_id,
      type,
      reference_id,
      name_snapshot,
      unit_price_minor,
      quantity,
      line_subtotal_minor,
      discount_amount_minor,
      line_total_minor,
      session_count_snapshot,
      sort_order
    ) values (
      v_draft.organization_id,
      v_tx.id,
      coalesce(v_item.app_id, 'txi-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14)),
      v_item.type,
      v_item.reference_id,
      v_item.name_snapshot,
      v_item.unit_price_minor,
      v_item.quantity,
      v_item.line_subtotal_minor,
      v_item.discount_amount_minor,
      v_item.line_total_minor,
      v_item.session_count_snapshot,
      v_item.sort_order
    );
  end loop;

  v_remaining := v_subtotal - v_line_discount;
  for v_discount in
    select * from public.checkout_discounts where checkout_draft_id = v_draft.id
  loop
    v_amount := public.checkout_discount_amount(
      v_subtotal,
      v_remaining,
      v_discount.type,
      v_discount.value
    );
    v_remaining := v_remaining - v_amount;
    insert into public.transaction_discounts (
      organization_id,
      transaction_id,
      app_id,
      type,
      value,
      label,
      reason,
      amount_applied_minor
    ) values (
      v_draft.organization_id,
      v_tx.id,
      coalesce(v_discount.app_id, 'txd-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14)),
      v_discount.type,
      v_discount.value,
      v_discount.label,
      v_discount.reason,
      v_amount
    );
  end loop;

  if v_wallet_charge>0 then
    -- Unique effect_key is stable per checkout draft; transaction and debit commit atomically.
    insert into public.stored_value_ledger_entries (organization_id,account_id,customer_id,type,amount_delta_minor,transaction_id,appointment_id,location_id,reason,effect_key,created_by_staff_id)
    values (v_draft.organization_id,v_wallet.id,v_draft.customer_id,'PAYMENT',-v_wallet_charge,v_tx.id,v_draft.appointment_id,v_draft.location_id,'CHECKOUT','checkout:'||v_draft.id::text,v_staff_id);
    select coalesce(sum(amount_delta_minor), 0) into v_wallet_balance
      from public.stored_value_ledger_entries
     where account_id = v_wallet.id;
    if v_wallet_balance < 0 then
      raise exception '儲值金餘額不足';
    end if;
  end if;

  for v_payment in
    select * from public.checkout_payments where checkout_draft_id = v_draft.id
  loop
    insert into public.transaction_payments (
      organization_id,
      transaction_id,
      app_id,
      method,
      amount_minor,
      reference,
      note,
      paid_at
    ) values (
      v_draft.organization_id,
      v_tx.id,
      coalesce(v_payment.app_id, 'txp-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14)),
      v_payment.method,
      v_payment.amount_minor,
      v_payment.reference,
      v_payment.note,
      v_now
    );
  end loop;

  update public.checkout_drafts
  set
    status = 'COMPLETED',
    subtotal_minor = v_subtotal,
    discount_total_minor = v_discount_total,
    total_minor = v_subtotal - v_discount_total,
    updated_at = v_now
  where id = v_draft.id
  returning * into v_draft;

  return public.commerce_checkout_bundle(v_draft);
end;
$function$
;

revoke all on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb) from public, anon;
revoke all on function public.settle_checkout_draft(text, timestamptz) from public, anon;
grant execute on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.settle_checkout_draft(text, timestamptz) to authenticated;
