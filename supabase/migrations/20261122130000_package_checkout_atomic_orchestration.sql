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
begin
  if auth.uid() is null then raise exception '沒有權限結帳'; end if;
  select * into v_draft from public.checkout_drafts
    where app_id=p_checkout_app_id for update;
  if v_draft.id is null then raise exception '找不到結帳資料'; end if;
  perform public.assert_commerce_checkout_actor(v_draft.organization_id,v_draft.location_id);

  -- Fail closed before charging anything. The dedicated endpoint handles exactly
  -- one package item, quantity one. Mixed-service checkout can be supported later.
  select count(*) into v_items from public.checkout_items i
    join public.package_definitions d
      on d.app_id=i.reference_id and d.organization_id=i.organization_id
    where i.checkout_draft_id=v_draft.id and i.type='PACKAGE_PURCHASE'
      and d.id=p_package_definition_id and i.quantity=1
      and i.session_count_snapshot=d.session_count
      and i.unit_price_minor=d.price_minor;
  if v_items<>1 or
    (select count(*) from public.checkout_items where checkout_draft_id=v_draft.id and type='PACKAGE_PURCHASE')<>1
  then raise exception '結帳套票項目不符'; end if;

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
