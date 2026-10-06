-- =============================================================================
-- Phase 1C-6H.3B — Package fulfillment + redemption
--
-- COMPLETED PACKAGE_PURCHASE Transaction → one Customer Package + PURCHASE ledger.
-- OPEN service CheckoutDraft can persist package_redemption; settle redeems
-- atomically in the same security-definer transaction.
--
-- Does NOT:
--   create a second package definition
--   create a second PACKAGE_PURCHASE transaction
--   open Stored Value
--   write from the browser with a privileged service key
--
-- Duplicate entitlement protection is durable:
--   UNIQUE (organization_id, purchase_transaction_id)
-- Ledger retries use existing UNIQUE (organization_id, effect_key).
--
-- Additive. No DROP / recreate of business tables. No business INSERTs
-- outside the security-definer functions.
-- =============================================================================

create unique index if not exists idx_customer_packages_org_purchase_tx
  on public.customer_packages (organization_id, purchase_transaction_id)
  where purchase_transaction_id is not null;

create or replace function public.package_definition_included_service_ids(
  p_included jsonb
)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct btrim(elem->>'serviceId')) filter (
    where coalesce(btrim(elem->>'serviceId'), '') <> ''
  ), '{}'::text[])
  from jsonb_array_elements(coalesce(p_included, '[]'::jsonb)) as elem;
$$;

create or replace function public.package_ledger_balance(
  p_customer_package_id uuid
)
returns integer
language sql
stable
as $$
  select coalesce(sum(session_delta), 0)::integer
  from public.package_ledger_entries
  where customer_package_id = p_customer_package_id;
$$;

create or replace function public.fulfill_package_purchase_from_transaction(
  p_transaction_id uuid
)
returns public.customer_packages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.transactions;
  v_item public.transaction_items;
  v_pkg public.package_definitions;
  v_cpkg public.customer_packages;
  v_included text[];
  v_effect text;
  v_expires timestamptz;
  v_now timestamptz := now();
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if v_tx.id is null then
    raise exception '找不到交易';
  end if;
  if v_tx.status <> 'COMPLETED' then
    raise exception '交易尚未完成，無法建立套票';
  end if;

  select * into v_item
  from public.transaction_items
  where transaction_id = v_tx.id
    and type = 'PACKAGE_PURCHASE'
  order by sort_order
  limit 1;
  if v_item.id is null then
    return null;
  end if;

  select * into v_cpkg
  from public.customer_packages
  where organization_id = v_tx.organization_id
    and purchase_transaction_id = v_tx.id
  limit 1
  for update;
  if v_cpkg.id is not null then
    v_effect := v_tx.app_id || ':PACKAGE_PURCHASE:' || v_cpkg.app_id;
    if not exists (
      select 1
      from public.package_ledger_entries
      where organization_id = v_tx.organization_id
        and effect_key = v_effect
    ) then
      insert into public.package_ledger_entries (
        organization_id,
        customer_package_id,
        customer_id,
        app_id,
        type,
        session_delta,
        transaction_id,
        location_id,
        effect_key,
        created_by_staff_id,
        created_at
      ) values (
        v_tx.organization_id,
        v_cpkg.id,
        v_tx.customer_id,
        'plg-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
        'PURCHASE',
        v_cpkg.session_count_snapshot,
        v_tx.id,
        v_tx.location_id,
        v_effect,
        v_tx.created_by_staff_id,
        v_now
      );
    end if;
    return v_cpkg;
  end if;

  select * into v_pkg
  from public.package_definitions
  where organization_id = v_tx.organization_id
    and app_id = v_item.reference_id
  limit 1
  for update;
  if v_pkg.id is null then
    raise exception '找不到套票方案';
  end if;
  if v_pkg.session_count is null or v_pkg.session_count < 1 then
    raise exception '套票堂數尚未設定，無法建立套票';
  end if;

  v_included := public.package_definition_included_service_ids(v_pkg.included_services);
  if v_pkg.validity_days is not null then
    v_expires := v_tx.completed_at + make_interval(days => v_pkg.validity_days);
  end if;

  insert into public.customer_packages (
    organization_id,
    customer_id,
    package_definition_id,
    purchase_transaction_id,
    app_id,
    name_snapshot,
    session_count_snapshot,
    price_snapshot_minor,
    included_service_ids_snapshot,
    purchased_at,
    activated_at,
    expires_at,
    status
  ) values (
    v_tx.organization_id,
    v_tx.customer_id,
    v_pkg.id,
    v_tx.id,
    'cpkg-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
    v_pkg.name,
    v_pkg.session_count,
    v_pkg.price_minor,
    v_included,
    v_tx.completed_at,
    v_tx.completed_at,
    v_expires,
    'ACTIVE'
  )
  returning * into v_cpkg;

  v_effect := v_tx.app_id || ':PACKAGE_PURCHASE:' || v_cpkg.app_id;
  insert into public.package_ledger_entries (
    organization_id,
    customer_package_id,
    customer_id,
    app_id,
    type,
    session_delta,
    transaction_id,
    location_id,
    effect_key,
    created_by_staff_id,
    created_at
  ) values (
    v_tx.organization_id,
    v_cpkg.id,
    v_tx.customer_id,
    'plg-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
    'PURCHASE',
    v_pkg.session_count,
    v_tx.id,
    v_tx.location_id,
    v_effect,
    v_tx.created_by_staff_id,
    v_now
  );

  return v_cpkg;
exception
  when unique_violation then
    select * into v_cpkg
    from public.customer_packages
    where organization_id = v_tx.organization_id
      and purchase_transaction_id = v_tx.id
    limit 1;
    if v_cpkg.id is null then
      raise;
    end if;
    return v_cpkg;
end;
$$;

create or replace function public.redeem_package_from_checkout(
  p_tx public.transactions,
  p_draft public.checkout_drafts,
  p_staff_id text
)
returns public.package_ledger_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption jsonb;
  v_cpkg public.customer_packages;
  v_svc public.services;
  v_entry public.package_ledger_entries;
  v_effect text;
  v_balance integer;
  v_now timestamptz := now();
begin
  v_redemption := coalesce(p_tx.package_redemption, p_draft.package_redemption);
  if v_redemption is null or v_redemption = 'null'::jsonb then
    return null;
  end if;
  if coalesce((v_redemption->>'sessions')::integer, 1) <> 1 then
    raise exception '套票一次僅能使用 1 堂';
  end if;
  if coalesce(btrim(v_redemption->>'customerPackageId'), '') = '' then
    raise exception '找不到可用套票';
  end if;
  if coalesce(btrim(v_redemption->>'serviceId'), '') = '' then
    raise exception '找不到可用套票';
  end if;

  select * into v_cpkg
  from public.customer_packages
  where organization_id = p_tx.organization_id
    and app_id = v_redemption->>'customerPackageId'
  limit 1
  for update;
  if v_cpkg.id is null then
    raise exception '找不到可用套票';
  end if;
  if v_cpkg.customer_id is distinct from p_tx.customer_id then
    raise exception '套票不屬於此客戶';
  end if;
  if v_cpkg.status = 'VOIDED' then
    raise exception '套票已作廢';
  end if;
  if v_cpkg.status = 'EXPIRED' or (
    v_cpkg.expires_at is not null and v_cpkg.expires_at < v_now
  ) then
    raise exception '套票已到期';
  end if;
  if not (v_redemption->>'serviceId' = any (v_cpkg.included_service_ids_snapshot)) then
    raise exception '此套票不適用本次服務';
  end if;

  select * into v_svc
  from public.services
  where organization_id = p_tx.organization_id
    and app_id = v_redemption->>'serviceId'
  limit 1;
  if v_svc.id is null then
    raise exception '此套票不適用本次服務';
  end if;

  v_effect := p_tx.app_id || ':PACKAGE_REDEMPTION:' || v_cpkg.app_id;
  select * into v_entry
  from public.package_ledger_entries
  where organization_id = p_tx.organization_id
    and effect_key = v_effect
  limit 1;
  if v_entry.id is not null then
    return v_entry;
  end if;

  v_balance := public.package_ledger_balance(v_cpkg.id);
  if v_balance < 1 then
    raise exception '套票剩餘堂數不足';
  end if;

  insert into public.package_ledger_entries (
    organization_id,
    customer_package_id,
    customer_id,
    app_id,
    type,
    session_delta,
    service_id,
    appointment_id,
    treatment_id,
    transaction_id,
    location_id,
    effect_key,
    created_by_staff_id,
    created_at
  ) values (
    p_tx.organization_id,
    v_cpkg.id,
    p_tx.customer_id,
    'plg-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
    'REDEMPTION',
    -1,
    v_svc.id,
    p_tx.appointment_id,
    p_tx.treatment_id,
    p_tx.id,
    p_tx.location_id,
    v_effect,
    p_staff_id,
    v_now
  )
  returning * into v_entry;

  if v_balance - 1 <= 0 then
    update public.customer_packages
    set status = 'EXHAUSTED'
    where id = v_cpkg.id
      and status = 'ACTIVE';
  end if;

  return v_entry;
exception
  when unique_violation then
    select * into v_entry
    from public.package_ledger_entries
    where organization_id = p_tx.organization_id
      and effect_key = v_effect
    limit 1;
    if v_entry.id is null then
      raise;
    end if;
    return v_entry;
end;
$$;

create or replace function public.apply_package_effects_for_transaction(
  p_tx public.transactions,
  p_draft public.checkout_drafts,
  p_staff_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fulfill_package_purchase_from_transaction(p_tx.id);
  perform public.redeem_package_from_checkout(p_tx, p_draft, p_staff_id);
end;
$$;

create or replace function public.commerce_checkout_bundle(p_draft public.checkout_drafts)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_app text;
  v_loc_app text;
  v_cust_app text;
  v_apt_app text;
  v_trt_app text;
  v_tx public.transactions;
begin
  select app_id into v_org_app from public.organizations where id = p_draft.organization_id;
  select app_id into v_loc_app from public.locations where id = p_draft.location_id;
  select app_id into v_cust_app from public.customers where id = p_draft.customer_id;
  if p_draft.appointment_id is not null then
    select app_id into v_apt_app from public.appointments where id = p_draft.appointment_id;
  end if;
  if p_draft.treatment_id is not null then
    select app_id into v_trt_app from public.treatments where id = p_draft.treatment_id;
  end if;
  select * into v_tx
  from public.transactions
  where organization_id = p_draft.organization_id
    and checkout_draft_id = p_draft.id
    and status = 'COMPLETED'
  limit 1;

  return jsonb_build_object(
    'draft', jsonb_build_object(
      'id', p_draft.app_id,
      'organizationId', v_org_app,
      'locationId', v_loc_app,
      'customerId', v_cust_app,
      'appointmentId', v_apt_app,
      'treatmentId', v_trt_app,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.app_id,
          'type', i.type,
          'referenceId', i.reference_id,
          'nameSnapshot', i.name_snapshot,
          'unitPrice', i.unit_price_minor,
          'quantity', i.quantity,
          'lineSubtotal', i.line_subtotal_minor,
          'discountAmount', i.discount_amount_minor,
          'lineTotal', i.line_total_minor,
          'sessionCountSnapshot', i.session_count_snapshot
        ) order by i.sort_order)
        from public.checkout_items i
        where i.checkout_draft_id = p_draft.id
      ), '[]'::jsonb),
      'discounts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.app_id,
          'type', d.type,
          'value', d.value,
          'label', d.label,
          'reason', d.reason,
          'createdByStaffId', d.created_by_staff_id
        ))
        from public.checkout_discounts d
        where d.checkout_draft_id = p_draft.id
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.app_id,
          'method', p.method,
          'amount', p.amount_minor,
          'reference', p.reference,
          'note', p.note
        ))
        from public.checkout_payments p
        where p.checkout_draft_id = p_draft.id
      ), '[]'::jsonb),
      'packageRedemption', p_draft.package_redemption,
      'subtotal', p_draft.subtotal_minor,
      'discountTotal', p_draft.discount_total_minor,
      'total', p_draft.total_minor,
      'currency', p_draft.currency,
      'status', p_draft.status,
      'createdByStaffId', p_draft.created_by_staff_id,
      'createdAt', p_draft.created_at,
      'updatedAt', p_draft.updated_at
    ),
    'transaction', case
      when v_tx.id is null then null
      else public.commerce_transaction_json(v_tx)
    end
  );
end;
$$;

create or replace function public.commerce_transaction_json(p_tx public.transactions)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_app text;
  v_loc_app text;
  v_cust_app text;
  v_apt_app text;
  v_trt_app text;
  v_chk_app text;
begin
  select app_id into v_org_app from public.organizations where id = p_tx.organization_id;
  select app_id into v_loc_app from public.locations where id = p_tx.location_id;
  select app_id into v_cust_app from public.customers where id = p_tx.customer_id;
  if p_tx.appointment_id is not null then
    select app_id into v_apt_app from public.appointments where id = p_tx.appointment_id;
  end if;
  if p_tx.treatment_id is not null then
    select app_id into v_trt_app from public.treatments where id = p_tx.treatment_id;
  end if;
  if p_tx.checkout_draft_id is not null then
    select app_id into v_chk_app from public.checkout_drafts where id = p_tx.checkout_draft_id;
  end if;
  return jsonb_build_object(
    'id', p_tx.app_id,
    'organizationId', v_org_app,
    'locationId', v_loc_app,
    'customerId', v_cust_app,
    'appointmentId', v_apt_app,
    'treatmentId', v_trt_app,
    'checkoutDraftId', v_chk_app,
    'transactionNumber', p_tx.transaction_number,
    'status', p_tx.status,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.app_id,
        'type', i.type,
        'referenceId', i.reference_id,
        'nameSnapshot', i.name_snapshot,
        'unitPrice', i.unit_price_minor,
        'quantity', i.quantity,
        'lineSubtotal', i.line_subtotal_minor,
        'discountAmount', i.discount_amount_minor,
        'lineTotal', i.line_total_minor,
        'sessionCountSnapshot', i.session_count_snapshot
      ) order by i.sort_order)
      from public.transaction_items i
      where i.transaction_id = p_tx.id
    ), '[]'::jsonb),
    'discounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.app_id,
        'type', d.type,
        'value', d.value,
        'label', d.label,
        'reason', d.reason,
        'amountApplied', d.amount_applied_minor
      ))
      from public.transaction_discounts d
      where d.transaction_id = p_tx.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.app_id,
        'method', p.method,
        'amount', p.amount_minor,
        'reference', p.reference,
        'note', p.note,
        'paidAt', p.paid_at
      ))
      from public.transaction_payments p
      where p.transaction_id = p_tx.id
    ), '[]'::jsonb),
    'packageRedemption', p_tx.package_redemption,
    'subtotal', p_tx.subtotal_minor,
    'discountTotal', p_tx.discount_total_minor,
    'total', p_tx.total_minor,
    'currency', p_tx.currency,
    'createdByStaffId', p_tx.created_by_staff_id,
    'completedAt', p_tx.completed_at,
    'voidedAt', p_tx.voided_at,
    'voidedBy', p_tx.voided_by,
    'voidReason', p_tx.void_reason
  );
end;
$$;

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
      if coalesce(v_payment->>'method', '') in ('STORED_VALUE', 'PACKAGE') then
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
      and method in ('STORED_VALUE', 'PACKAGE')
  ) then
    raise exception '此付款方式目前尚未開放';
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

create or replace function public.repair_package_fulfillment(
  p_transaction_app_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.transactions;
  v_staff_id text;
  v_role public.staff_role;
  v_cpkg public.customer_packages;
  v_packages_before integer;
  v_ledger_before integer;
  v_packages_after integer;
  v_ledger_after integer;
begin
  if auth.uid() is null then
    raise exception '沒有權限結帳';
  end if;
  if p_transaction_app_id is null or btrim(p_transaction_app_id) = '' then
    raise exception '找不到交易';
  end if;

  select * into v_tx
  from public.transactions
  where app_id = p_transaction_app_id
  limit 1
  for update;
  if v_tx.id is null then
    raise exception '找不到交易';
  end if;

  v_staff_id := public.assert_commerce_checkout_actor(v_tx.organization_id, v_tx.location_id);
  v_role := public.user_org_role(v_tx.organization_id);
  if v_role is null or not public.staff_role_is_managerial(v_role) then
    raise exception '沒有權限結帳';
  end if;
  if v_tx.status <> 'COMPLETED' then
    raise exception '交易尚未完成，無法建立套票';
  end if;
  if not exists (
    select 1
    from public.transaction_items
    where transaction_id = v_tx.id
      and type = 'PACKAGE_PURCHASE'
  ) then
    raise exception '此交易不是套票購買';
  end if;

  select count(*) into v_packages_before
  from public.customer_packages
  where organization_id = v_tx.organization_id
    and purchase_transaction_id = v_tx.id;
  select count(*) into v_ledger_before
  from public.package_ledger_entries
  where organization_id = v_tx.organization_id
    and transaction_id = v_tx.id;

  v_cpkg := public.fulfill_package_purchase_from_transaction(v_tx.id);

  select count(*) into v_packages_after
  from public.customer_packages
  where organization_id = v_tx.organization_id
    and purchase_transaction_id = v_tx.id;
  select count(*) into v_ledger_after
  from public.package_ledger_entries
  where organization_id = v_tx.organization_id
    and transaction_id = v_tx.id;

  return jsonb_build_object(
    'repaired', v_packages_before = 0 and v_packages_after = 1,
    'transactionAppId', v_tx.app_id,
    'transactionNumber', v_tx.transaction_number,
    'customerPackageAppId', v_cpkg.app_id,
    'customerPackageId', v_cpkg.id,
    'initialSessions', v_cpkg.session_count_snapshot,
    'remainingSessions', public.package_ledger_balance(v_cpkg.id),
    'customerPackagesBefore', v_packages_before,
    'customerPackagesAfter', v_packages_after,
    'ledgerBefore', v_ledger_before,
    'ledgerAfter', v_ledger_after,
    'createdByStaffId', v_staff_id
  );
end;
$$;

revoke all on function public.package_definition_included_service_ids(jsonb) from public, anon;
revoke all on function public.package_ledger_balance(uuid) from public, anon, authenticated;
revoke all on function public.fulfill_package_purchase_from_transaction(uuid) from public, anon, authenticated;
revoke all on function public.redeem_package_from_checkout(public.transactions, public.checkout_drafts, text) from public, anon, authenticated;
revoke all on function public.apply_package_effects_for_transaction(public.transactions, public.checkout_drafts, text) from public, anon, authenticated;
revoke all on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.repair_package_fulfillment(text) from public, anon;
revoke all on function public.commerce_checkout_bundle(public.checkout_drafts) from public, anon, authenticated;
revoke all on function public.commerce_transaction_json(public.transactions) from public, anon, authenticated;

grant execute on function public.package_definition_included_service_ids(jsonb) to authenticated;
grant execute on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.settle_checkout_draft(text, timestamptz) to authenticated;
grant execute on function public.repair_package_fulfillment(text) to authenticated;
