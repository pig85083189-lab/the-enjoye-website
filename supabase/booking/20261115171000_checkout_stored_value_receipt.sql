-- Booking database only (knccefcxncglgpmvgqlp).
-- Do not apply this file to the finance database or to production until the
-- isolated compatibility cases pass. It does not debit a wallet and does not
-- choose a finance customer.
--
-- The save and settle functions below are the production package checkout
-- functions. Package redemption, discounts, payments, transaction lines,
-- staff permission checks, replay, and apply_package_effects_for_transaction
-- stay as they are. The only checkout change is the stored-value gate:
-- PACKAGE stays closed; STORED_VALUE may be saved on the draft, and settle
-- accepts it only when a posted receipt matches that amount. The four-argument
-- save still forwards the draft's existing package redemption to the
-- five-argument save, so a payment update does not clear a package selection.

create table if not exists public.stored_value_debit_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  checkout_app_id text not null,
  source_customer_key text not null,
  amount_minor bigint not null,
  effect_key text not null,
  status text not null,
  created_at timestamptz not null default now(),
  constraint stored_value_debit_receipts_status check (status = 'POSTED'),
  constraint stored_value_debit_receipts_amount check (amount_minor > 0),
  constraint stored_value_debit_receipts_key check (char_length(btrim(source_customer_key)) between 8 and 120),
  unique (organization_id, checkout_app_id)
);

alter table public.stored_value_debit_receipts enable row level security;
revoke all on public.stored_value_debit_receipts from public, anon, authenticated;

create or replace function public.save_checkout_draft(
  p_checkout_app_id text,
  p_expected_updated_at timestamptz,
  p_payments jsonb,
  p_discounts jsonb,
  p_package_redemption jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.checkout_drafts;
  v_staff_id text;
  v_payment jsonb;
  v_discount jsonb;
  v_item public.checkout_items;
  v_subtotal bigint := 0;
  v_line_discount bigint := 0;
  v_remaining bigint;
  v_discount_total bigint;
  v_amount bigint;
  v_cpkg public.customer_packages;
  v_redemption jsonb;
  v_service_id text;
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

  if p_package_redemption is null or p_package_redemption = 'null'::jsonb then
    v_redemption := null;
    for v_item in
      select * from public.checkout_items
      where checkout_draft_id = v_draft.id
        and type = 'SERVICE'
    loop
      update public.checkout_items
      set
        discount_amount_minor = 0,
        line_total_minor = line_subtotal_minor
      where id = v_item.id;
    end loop;
  else
    if coalesce((p_package_redemption->>'sessions')::integer, 1) <> 1 then
      raise exception '套票一次僅能使用 1 堂';
    end if;
    v_service_id := btrim(coalesce(p_package_redemption->>'serviceId', ''));
    if v_service_id = '' then
      raise exception '找不到可用套票';
    end if;
    select * into v_cpkg
    from public.customer_packages
    where organization_id = v_draft.organization_id
      and customer_id = v_draft.customer_id
      and app_id = p_package_redemption->>'customerPackageId'
    limit 1
    for update;
    if v_cpkg.id is null then
      raise exception '找不到可用套票';
    end if;
    if v_cpkg.status <> 'ACTIVE' then
      raise exception '套票無法使用';
    end if;
    if v_cpkg.expires_at is not null and v_cpkg.expires_at < now() then
      raise exception '套票已到期';
    end if;
    if not (v_service_id = any (v_cpkg.included_service_ids_snapshot)) then
      raise exception '此套票不適用本次服務';
    end if;
    if public.package_ledger_balance(v_cpkg.id) < 1 then
      raise exception '套票剩餘堂數不足';
    end if;
    if not exists (
      select 1
      from public.checkout_items
      where checkout_draft_id = v_draft.id
        and type = 'SERVICE'
        and reference_id = v_service_id
    ) then
      raise exception '此套票不適用本次服務';
    end if;
    v_redemption := jsonb_build_object(
      'customerPackageId', v_cpkg.app_id,
      'serviceId', v_service_id,
      'sessions', 1
    );
    update public.checkout_items
    set
      discount_amount_minor = case
        when type = 'SERVICE' and reference_id = v_service_id then line_subtotal_minor
        else discount_amount_minor
      end,
      line_total_minor = case
        when type = 'SERVICE' and reference_id = v_service_id then 0
        else line_total_minor
      end
    where checkout_draft_id = v_draft.id;
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
    package_redemption = v_redemption,
    subtotal_minor = v_subtotal,
    discount_total_minor = v_discount_total,
    total_minor = v_subtotal - v_discount_total,
    updated_at = now()
  where id = v_draft.id
  returning * into v_draft;

  return public.commerce_checkout_bundle(v_draft);
end;
$$;

create or replace function public.save_checkout_draft(
  p_checkout_app_id text,
  p_expected_updated_at timestamptz,
  p_payments jsonb,
  p_discounts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing jsonb;
begin
  select package_redemption into v_existing
  from public.checkout_drafts
  where app_id = p_checkout_app_id;
  return public.save_checkout_draft(
    p_checkout_app_id,
    p_expected_updated_at,
    p_payments,
    p_discounts,
    v_existing
  );
end;
$$;

create or replace function public.settle_checkout_draft(
  p_checkout_app_id text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    limit 1
    for update;
    if v_tx.id is null then
      raise exception '結帳已完成，但找不到交易';
    end if;
    perform public.apply_package_effects_for_transaction(v_tx, v_draft, v_staff_id);
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
    perform public.apply_package_effects_for_transaction(v_tx, v_draft, v_staff_id);
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
      where receipt.organization_id = v_draft.organization_id
        and receipt.checkout_app_id = v_draft.app_id
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
    package_redemption,
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
    v_draft.package_redemption,
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

  perform public.apply_package_effects_for_transaction(v_tx, v_draft, v_staff_id);

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
$$;

revoke all on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb) from public, anon;
revoke all on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.settle_checkout_draft(text, timestamptz) from public, anon;

grant execute on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.settle_checkout_draft(text, timestamptz) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert on public.stored_value_debit_receipts to service_role';
  end if;
end $$;
