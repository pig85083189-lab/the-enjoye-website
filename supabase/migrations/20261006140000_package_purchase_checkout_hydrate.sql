-- =============================================================================
-- Phase 1C-6H.3A — Package purchase → OPEN CheckoutDraft hydrate
--
-- Package is another canonical commerce item. This RPC only creates or reuses
-- one OPEN/READY unscheduled CheckoutDraft + PACKAGE_PURCHASE item.
--
-- Does NOT:
--   settle
--   create customer_packages
--   write package_ledger_entries
--   open Stored Value
--
-- Direct checkout_* table writes stay revoked. Authenticated clients must
-- call this security-definer RPC.
--
-- Additive. No DROP / recreate of business tables. No business INSERTs
-- outside the hydrate function.
-- =============================================================================

create unique index if not exists idx_checkout_drafts_open_unscheduled
  on public.checkout_drafts (organization_id, customer_id)
  where appointment_id is null
    and status in ('OPEN', 'READY');

create or replace function public.hydrate_checkout_from_package(
  p_customer_app_id text,
  p_package_definition_app_id text,
  p_location_app_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust public.customers;
  v_loc public.locations;
  v_pkg public.package_definitions;
  v_staff_id text;
  v_draft public.checkout_drafts;
  v_item_subtotal bigint;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception '沒有權限結帳';
  end if;
  if p_customer_app_id is null or btrim(p_customer_app_id) = '' then
    raise exception '找不到結帳資料';
  end if;
  if p_package_definition_app_id is null or btrim(p_package_definition_app_id) = '' then
    raise exception '找不到結帳資料';
  end if;
  if p_location_app_id is null or btrim(p_location_app_id) = '' then
    raise exception '找不到結帳資料';
  end if;

  select * into v_cust
  from public.customers
  where app_id = p_customer_app_id
  limit 1;
  if v_cust.id is null then
    raise exception '找不到結帳資料';
  end if;

  select * into v_loc
  from public.locations
  where app_id = p_location_app_id
    and organization_id = v_cust.organization_id
  limit 1;
  if v_loc.id is null then
    raise exception '找不到結帳資料';
  end if;

  v_staff_id := public.assert_commerce_checkout_actor(v_cust.organization_id, v_loc.id);

  select * into v_pkg
  from public.package_definitions
  where app_id = p_package_definition_app_id
    and organization_id = v_cust.organization_id
  limit 1;
  if v_pkg.id is null then
    raise exception '找不到結帳資料';
  end if;
  if v_pkg.is_active is not true then
    raise exception '套票方案已停用，無法結帳';
  end if;
  if v_pkg.price_minor is null or v_pkg.price_minor < 0 then
    raise exception '套票價格尚未設定，無法結帳';
  end if;
  if v_pkg.session_count is null or v_pkg.session_count < 1 then
    raise exception '套票堂數尚未設定，無法結帳';
  end if;

  select d.* into v_draft
  from public.checkout_drafts d
  join public.checkout_items i on i.checkout_draft_id = d.id
  where d.organization_id = v_cust.organization_id
    and d.customer_id = v_cust.id
    and d.appointment_id is null
    and d.status in ('OPEN', 'READY')
    and i.type = 'PACKAGE_PURCHASE'
    and i.reference_id = v_pkg.app_id
  order by d.created_at
  limit 1
  for update of d;

  if v_draft.id is not null then
    return public.commerce_checkout_bundle(v_draft);
  end if;

  select * into v_draft
  from public.checkout_drafts
  where organization_id = v_cust.organization_id
    and customer_id = v_cust.id
    and appointment_id is null
    and status in ('OPEN', 'READY')
  order by created_at
  limit 1
  for update;

  if v_draft.id is not null then
    return public.commerce_checkout_bundle(v_draft);
  end if;

  v_item_subtotal := v_pkg.price_minor;
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
    v_cust.organization_id,
    v_loc.id,
    v_cust.id,
    null,
    null,
    'chk-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
    v_item_subtotal,
    0,
    v_item_subtotal,
    coalesce(v_pkg.currency, 'TWD'),
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
    session_count_snapshot,
    sort_order
  ) values (
    v_cust.organization_id,
    v_draft.id,
    'cli-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
    'PACKAGE_PURCHASE',
    v_pkg.app_id,
    v_pkg.name,
    v_pkg.price_minor,
    1,
    v_item_subtotal,
    0,
    v_item_subtotal,
    v_pkg.session_count,
    0
  );

  return public.commerce_checkout_bundle(v_draft);
exception
  when unique_violation then
    select * into v_draft
    from public.checkout_drafts
    where organization_id = v_cust.organization_id
      and customer_id = v_cust.id
      and appointment_id is null
      and status in ('OPEN', 'READY')
    order by created_at
    limit 1;
    if v_draft.id is null then
      raise;
    end if;
    return public.commerce_checkout_bundle(v_draft);
end;
$$;

revoke all on function public.hydrate_checkout_from_package(text, text, text) from public, anon;
grant execute on function public.hydrate_checkout_from_package(text, text, text) to authenticated;
