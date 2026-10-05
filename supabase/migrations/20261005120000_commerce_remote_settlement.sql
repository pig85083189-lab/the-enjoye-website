-- =============================================================================
-- Beauty OS — Phase 1C-6H.2 Commerce remote settlement
-- Additive only. Reuses public.checkout_* and public.transaction_* tables.
-- Do not drop / recreate commerce tables. Do not write ledgers here.
-- =============================================================================

create or replace function public.staff_role_can_checkout(role public.staff_role)
returns boolean
language sql
immutable
as $$
  select role in ('OWNER', 'MANAGER', 'STAFF', 'RECEPTIONIST');
$$;

comment on function public.staff_role_can_checkout(public.staff_role) is
  'Checkout roles: OWNER / MANAGER / STAFF / RECEPTIONIST. ACCOUNTANT is denied.';

create or replace function public.current_operational_staff_id(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
  from public.staff_auth_memberships m
  join public.organizations o on o.app_id = m.organization_id
  where o.id = target_org
    and m.auth_user_id = auth.uid()
    and m.is_active = true
    and public.is_operational_staff_id(m.user_id)
  order by case m.role
    when 'OWNER' then 0
    when 'MANAGER' then 1
    else 2
  end
  limit 1;
$$;

comment on function public.current_operational_staff_id(uuid) is
  'Authenticated membership.user_id (staff-*). Never returns auth.users.id.';

create table if not exists public.transaction_number_sequences (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  issued_on date not null,
  last_value integer not null default 0,
  primary key (organization_id, issued_on),
  constraint transaction_number_sequences_last_value_positive check (last_value >= 0)
);

alter table public.transaction_number_sequences enable row level security;

revoke all on public.transaction_number_sequences from public, anon, authenticated;

create or replace function public.next_transaction_number(
  p_organization_id uuid,
  p_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_seq integer;
begin
  v_day := (p_at at time zone 'Asia/Taipei')::date;
  insert into public.transaction_number_sequences (organization_id, issued_on, last_value)
  values (p_organization_id, v_day, 1)
  on conflict (organization_id, issued_on)
  do update set last_value = public.transaction_number_sequences.last_value + 1
  returning last_value into v_seq;
  return 'TX-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

create or replace function public.checkout_discount_amount(
  p_subtotal bigint,
  p_remaining bigint,
  p_type public.discount_type,
  p_value bigint
)
returns bigint
language plpgsql
immutable
as $$
declare
  v_amount bigint := 0;
begin
  if p_type = 'ORDER_FIXED' then
    v_amount := least(greatest(p_value, 0), p_remaining);
  elsif p_type = 'ORDER_PERCENTAGE' then
    if p_value < 0 or p_value > 10000 then
      raise exception '折扣百分比無效';
    end if;
    v_amount := least(floor(p_subtotal * p_value / 10000.0)::bigint, p_remaining);
  else
    raise exception '不支援的折扣類型';
  end if;
  return greatest(v_amount, 0);
end;
$$;

create or replace function public.assert_commerce_checkout_actor(
  p_organization_id uuid,
  p_location_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.staff_role;
  v_staff_id text;
begin
  if auth.uid() is null then
    raise exception '沒有權限結帳';
  end if;
  if not public.user_has_org_membership(p_organization_id) then
    raise exception '沒有權限結帳';
  end if;
  if not public.user_can_access_location(p_organization_id, p_location_id) then
    raise exception '沒有權限結帳';
  end if;
  v_role := public.user_org_role(p_organization_id);
  if v_role is null or not public.staff_role_can_checkout(v_role) then
    raise exception '沒有權限結帳';
  end if;
  v_staff_id := public.current_operational_staff_id(p_organization_id);
  if v_staff_id is null or public.is_auth_uuid(v_staff_id) then
    raise exception '結帳人員身分無效';
  end if;
  return v_staff_id;
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

create or replace function public.hydrate_checkout_from_treatment(
  p_appointment_app_id text,
  p_treatment_app_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apt public.appointments;
  v_trt public.treatments;
  v_svc public.services;
  v_staff_id text;
  v_draft public.checkout_drafts;
  v_item_subtotal bigint;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception '沒有權限結帳';
  end if;

  select * into v_apt
  from public.appointments
  where app_id = p_appointment_app_id
  limit 1;
  if v_apt.id is null then
    raise exception '找不到結帳資料';
  end if;

  v_staff_id := public.assert_commerce_checkout_actor(v_apt.organization_id, v_apt.location_id);

  select * into v_trt
  from public.treatments
  where app_id = p_treatment_app_id
    and organization_id = v_apt.organization_id
  limit 1;
  if v_trt.id is null then
    raise exception '找不到結帳資料';
  end if;
  if v_trt.status <> 'COMPLETED' then
    raise exception '療程尚未完成，無法結帳';
  end if;
  if v_apt.status in ('CANCELLED', 'NO_SHOW', 'DRAFT') then
    raise exception '此預約無法結帳';
  end if;
  if v_trt.appointment_id is distinct from v_apt.id
     or v_trt.customer_id is distinct from v_apt.customer_id
     or v_trt.location_id is distinct from v_apt.location_id
     or v_trt.organization_id is distinct from v_apt.organization_id then
    raise exception '沒有權限結帳';
  end if;

  select * into v_svc
  from public.services
  where id = v_apt.service_id
    and organization_id = v_apt.organization_id;
  if v_svc.id is null then
    raise exception '找不到結帳資料';
  end if;
  if v_svc.price_minor is null then
    raise exception '服務價格尚未設定，無法結帳';
  end if;
  if v_svc.price_minor < 0 then
    raise exception '服務價格尚未設定，無法結帳';
  end if;

  select * into v_draft
  from public.checkout_drafts
  where organization_id = v_apt.organization_id
    and appointment_id = v_apt.id
    and status in ('OPEN', 'READY')
  order by created_at
  limit 1
  for update;

  if v_draft.id is not null then
    return public.commerce_checkout_bundle(v_draft);
  end if;

  select * into v_draft
  from public.checkout_drafts
  where organization_id = v_apt.organization_id
    and appointment_id = v_apt.id
    and status = 'COMPLETED'
  order by created_at desc
  limit 1;

  if v_draft.id is not null then
    return public.commerce_checkout_bundle(v_draft);
  end if;

  v_item_subtotal := v_svc.price_minor;
  insert into public.checkout_drafts (
    organization_id,
    location_id,
    customer_id,
    appointment_id,
    treatment_id,
    app_id,
    subtotal_minor,
    discount_total_minor,
    total_minor,
    currency,
    status,
    created_by_staff_id,
    created_at,
    updated_at
  ) values (
    v_apt.organization_id,
    v_apt.location_id,
    v_apt.customer_id,
    v_apt.id,
    v_trt.id,
    'chk-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
    v_item_subtotal,
    0,
    v_item_subtotal,
    'TWD',
    'OPEN',
    v_staff_id,
    v_now,
    v_now
  )
  returning * into v_draft;

  insert into public.checkout_items (
    organization_id,
    checkout_draft_id,
    app_id,
    type,
    reference_id,
    name_snapshot,
    unit_price_minor,
    quantity,
    line_subtotal_minor,
    discount_amount_minor,
    line_total_minor,
    sort_order
  ) values (
    v_apt.organization_id,
    v_draft.id,
    'cli-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
    'SERVICE',
    v_svc.app_id,
    v_svc.name,
    v_svc.price_minor,
    1,
    v_item_subtotal,
    0,
    v_item_subtotal,
    0
  );

  return public.commerce_checkout_bundle(v_draft);
exception
  when unique_violation then
    select * into v_draft
    from public.checkout_drafts
    where organization_id = v_apt.organization_id
      and appointment_id = v_apt.id
      and status in ('OPEN', 'READY', 'COMPLETED')
    order by created_at
    limit 1;
    if v_draft.id is null then
      raise;
    end if;
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
    subtotal_minor = v_subtotal,
    discount_total_minor = v_discount_total,
    total_minor = v_subtotal - v_discount_total,
    updated_at = now()
  where id = v_draft.id
  returning * into v_draft;

  return public.commerce_checkout_bundle(v_draft);
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
$$;

revoke all on function public.staff_role_can_checkout(public.staff_role) from public, anon;
revoke all on function public.current_operational_staff_id(uuid) from public, anon;
revoke all on function public.next_transaction_number(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.checkout_discount_amount(bigint, bigint, public.discount_type, bigint) from public, anon, authenticated;
revoke all on function public.assert_commerce_checkout_actor(uuid, uuid) from public, anon, authenticated;
revoke all on function public.commerce_checkout_bundle(public.checkout_drafts) from public, anon, authenticated;
revoke all on function public.commerce_transaction_json(public.transactions) from public, anon, authenticated;
create or replace function public.commerce_list_transactions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '沒有權限結帳';
  end if;
  return coalesce((
    select jsonb_agg(public.commerce_transaction_json(t) order by t.completed_at desc)
    from public.transactions t
    where public.user_has_org_membership(t.organization_id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.hydrate_checkout_from_treatment(text, text) from public, anon;
revoke all on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb) from public, anon;
revoke all on function public.settle_checkout_draft(text, timestamptz) from public, anon;
revoke all on function public.commerce_list_transactions() from public, anon;

grant execute on function public.staff_role_can_checkout(public.staff_role) to authenticated;
grant execute on function public.current_operational_staff_id(uuid) to authenticated;
grant execute on function public.hydrate_checkout_from_treatment(text, text) to authenticated;
grant execute on function public.save_checkout_draft(text, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.settle_checkout_draft(text, timestamptz) to authenticated;
grant execute on function public.commerce_list_transactions() to authenticated;
