-- Isolated reconstruction of the booking checkout functions and receipt-table
-- privileges that PR #84 replaces.
-- Preimage commit: 05924b3d69a362b937eb31a261ce8bdfee659a58
-- This file was generated from a local database loaded with that commit's SQL.
-- It is not a live catalog dump of knccefcxncglgpmvgqlp.
-- Do not apply it to production until supabase/rollback/production-catalog-readonly.sql
-- returns the same function definitions.
-- Applying this file does not delete stored_value_debit_receipts rows and does
-- not narrow the status check. A PENDING or FAILED receipt must remain valid.
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
    return public.commerce_checkout_bundle(v_draft);
  end if;
  if v_draft.status not in ('OPEN', 'READY') then
    raise exception '結帳狀態無法收款';
  end if;
  if v_draft.updated_at is distinct from p_expected_updated_at then
    raise exception '資料已更新，請重新整理後再試';
  end if;

  if v_draft.appointment_id is not null then
    select * into v_apt from public.appointments where id = v_draft.appointment_id;
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

  if exists (
    select 1
    from public.checkout_payments
    where checkout_draft_id = v_draft.id
      and method = 'PACKAGE'
  ) then
    raise exception '此付款方式目前尚未開放';
  end if;

  if exists (
    select 1
    from public.checkout_payments
    where checkout_draft_id = v_draft.id
      and method = 'STORED_VALUE'
  ) then
    if not exists (
      select 1
      from public.stored_value_debit_receipts receipt
      where receipt.checkout_app_id = v_draft.app_id
        and receipt.organization_id = v_draft.organization_id
        and receipt.status = 'POSTED'
        and receipt.amount_minor = (
          select coalesce(sum(payment.amount_minor), 0)
          from public.checkout_payments payment
          where payment.checkout_draft_id = v_draft.id
            and payment.method = 'STORED_VALUE'
        )
    ) then
      raise exception '此付款方式目前尚未開放';
    end if;
  end if;

  if (v_subtotal - v_discount_total) = 0 then
    if v_pay_sum <> 0 then
      raise exception '付款金額與應收不符';
    end if;
  elsif v_pay_sum <> (v_subtotal - v_discount_total) then
    raise exception '付款金額與應收不符';
  elsif v_pay_sum = 0 then
    raise exception '付款金額與應收不符';
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

REVOKE ALL ON FUNCTION save_checkout_draft(text,timestamp with time zone,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION settle_checkout_draft(text,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION save_checkout_draft(text,timestamp with time zone,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION save_checkout_draft(text,timestamp with time zone,jsonb,jsonb) TO ubuntu;
GRANT EXECUTE ON FUNCTION settle_checkout_draft(text,timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION settle_checkout_draft(text,timestamp with time zone) TO ubuntu;
REVOKE ALL ON TABLE public.stored_value_debit_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON TABLE public.stored_value_debit_receipts TO ubuntu;
GRANT SELECT ON TABLE public.stored_value_debit_receipts TO ubuntu;
GRANT UPDATE ON TABLE public.stored_value_debit_receipts TO ubuntu;
GRANT DELETE ON TABLE public.stored_value_debit_receipts TO ubuntu;
GRANT TRUNCATE ON TABLE public.stored_value_debit_receipts TO ubuntu;
GRANT REFERENCES ON TABLE public.stored_value_debit_receipts TO ubuntu;
GRANT TRIGGER ON TABLE public.stored_value_debit_receipts TO ubuntu;

DROP FUNCTION IF EXISTS public.claim_stored_value_debit_receipt(uuid, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.commit_stored_value_debit_receipt(uuid, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.abandon_stored_value_debit_receipt(uuid, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.save_checkout_draft(text, timestamptz, jsonb, jsonb, jsonb);
