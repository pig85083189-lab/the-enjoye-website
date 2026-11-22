-- Atomic checkout + package purchase orchestration.
-- A failure in package posting rolls back settle_checkout_draft as well.
-- This is an opt-in RPC: existing checkout callers are untouched.
create or replace function public.settle_checkout_with_package_purchase(
  p_checkout_app_id text,
  p_expected_updated_at timestamptz,
  p_package_definition_id uuid
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_draft public.checkout_drafts;
  v_tx public.transactions;
  v_bundle jsonb;
  v_package uuid;
  v_items integer;
  v_def public.package_definitions;
begin
  if auth.uid() is null then raise exception '沒有權限結帳'; end if;
  select * into v_draft from public.checkout_drafts
    where app_id=p_checkout_app_id for update;
  if v_draft.id is null then raise exception '找不到結帳資料'; end if;
  perform public.assert_commerce_checkout_actor(v_draft.organization_id,v_draft.location_id);
  if v_draft.status not in ('OPEN','READY') or
     v_draft.updated_at is distinct from p_expected_updated_at then
    raise exception '結帳資料已更新或無法購買套票，請重新整理';
  end if;
  if v_draft.customer_id is null then raise exception '購買套票必須指定顧客'; end if;
  if v_draft.package_redemption is not null and
     v_draft.package_redemption <> 'null'::jsonb then
    raise exception '購買套票不可同時扣堂';
  end if;

  select * into v_def from public.package_definitions
    where id=p_package_definition_id and organization_id=v_draft.organization_id
      and is_active=true for share;
  if v_def.id is null or v_def.session_count<1 or v_def.price_minor<0
    or jsonb_typeof(v_def.included_services)<>'array'
    or jsonb_array_length(v_def.included_services)=0
    or exists (select 1 from jsonb_array_elements(v_def.included_services) x
      where nullif(trim(x->>'serviceId'),'') is null)
  then raise exception '套票方案無效或未指定療程'; end if;

  -- Fail closed before charging anything. The dedicated endpoint handles exactly
  -- one package item, quantity one. Mixed-service checkout can be supported later.
  select count(*) into v_items from public.checkout_items i
    join public.package_definitions d
      on d.app_id=i.reference_id and d.organization_id=i.organization_id
    where i.checkout_draft_id=v_draft.id and i.type='PACKAGE_PURCHASE'
      and d.id=p_package_definition_id and i.quantity=1
      and i.session_count_snapshot=d.session_count
      and i.unit_price_minor=d.price_minor
      and i.line_subtotal_minor=d.price_minor
      and i.line_total_minor=d.price_minor
      and i.discount_amount_minor=0;
  if v_items<>1 or
    (select count(*) from public.checkout_items where checkout_draft_id=v_draft.id)<>1
    or exists (select 1 from public.checkout_discounts where checkout_draft_id=v_draft.id)
    or v_draft.subtotal_minor is distinct from v_def.price_minor
    or v_draft.discount_total_minor is distinct from 0
    or v_draft.total_minor is distinct from v_def.price_minor
    or coalesce((select sum(amount_minor) from public.checkout_payments
                 where checkout_draft_id=v_draft.id),0) is distinct from v_def.price_minor
  then raise exception '結帳套票項目不符'; end if;

  -- Trigger rejects generic PACKAGE_PURCHASE checkout without this context.
  perform set_config('beauty_os.atomic_package_purchase',v_draft.id::text,true);
  perform set_config('beauty_os.atomic_package_definition',v_def.id::text,true);
  v_bundle := public.settle_checkout_draft(p_checkout_app_id,p_expected_updated_at);
  select * into v_tx from public.transactions
    where checkout_draft_id=v_draft.id and organization_id=v_draft.organization_id
      and status='COMPLETED' for update;
  if v_tx.id is null then raise exception '結帳交易未完成'; end if;
  v_package := public.atomic_purchase_customer_package(
    v_tx.id,p_package_definition_id,'checkout-package:'||v_draft.id::text
  );
  return v_bundle || jsonb_build_object('customerPackageDbId',v_package::text);
end; $$;

revoke all on function public.settle_checkout_with_package_purchase(text,timestamptz,uuid) from public,anon;
grant execute on function public.settle_checkout_with_package_purchase(text,timestamptz,uuid) to authenticated;

comment on function public.settle_checkout_with_package_purchase(text,timestamptz,uuid)
is 'Opt-in checkout plus package purchase in one transaction. Not wired to existing checkout until verified.';
