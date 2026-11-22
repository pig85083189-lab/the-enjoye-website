-- Opt-in atomic checkout + package redemption.
-- Existing checkout RPC and UI are not replaced.
create or replace function public.settle_checkout_with_package_redemption(
  p_checkout_app_id text,
  p_expected_updated_at timestamptz,
  p_customer_package_id uuid,
  p_service_id uuid
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_draft public.checkout_drafts;
  v_package public.customer_packages;
  v_service public.services;
  v_tx public.transactions;
  v_bundle jsonb;
  v_entry uuid;
begin
  if auth.uid() is null then raise exception '沒有權限結帳'; end if;
  select * into v_draft from public.checkout_drafts where app_id=p_checkout_app_id for update;
  if v_draft.id is null then raise exception '找不到結帳資料'; end if;
  perform public.assert_commerce_checkout_actor(v_draft.organization_id,v_draft.location_id);

  -- Lock package before settlement. Concurrent checkouts for the same package
  -- serialize here, before payment settlement can complete.
  select * into v_package from public.customer_packages
    where id=p_customer_package_id and organization_id=v_draft.organization_id for update;
  if v_package.id is null or v_package.customer_id is distinct from v_draft.customer_id
  then raise exception '套票與結帳顧客不符'; end if;
  if v_package.status<>'ACTIVE' or
     (v_package.expires_at is not null and v_package.expires_at<=now())
  then raise exception '套票已失效'; end if;

  select * into v_service from public.services
    where id=p_service_id and organization_id=v_draft.organization_id;
  if v_service.id is null or not (v_service.app_id=any(v_package.included_service_ids_snapshot))
  then raise exception '此療程不適用該套票'; end if;
  if not exists(select 1 from public.checkout_items
    where checkout_draft_id=v_draft.id and type='SERVICE'
      and reference_id=v_service.app_id)
  then raise exception '結帳未包含指定療程'; end if;
  if v_draft.treatment_id is not null and not exists (
    select 1 from public.treatments
    where id=v_draft.treatment_id and organization_id=v_draft.organization_id
      and service_id=p_service_id
  ) then raise exception '療程紀錄與套票不符'; end if;

  if coalesce((v_draft.package_redemption->>'customerPackageId'),'')<>v_package.app_id
     or coalesce((v_draft.package_redemption->>'serviceId'),'')<>v_service.app_id
  then raise exception '套票扣堂選擇與結帳資料不符'; end if;

  -- Current settle_checkout_draft does not accept PACKAGE as a payment method.
  -- Never silently charge cash or stored value for a package-covered service.
  -- The full checkout must be zero after discounts for this opt-in route.
  if v_draft.total_minor<>0 then
    raise exception '套票扣堂結帳必須為零元，請先確認折抵明細';
  end if;

  v_bundle:=public.settle_checkout_draft(p_checkout_app_id,p_expected_updated_at);
  select * into v_tx from public.transactions
    where checkout_draft_id=v_draft.id and organization_id=v_draft.organization_id
      and status='COMPLETED' for update;
  if v_tx.id is null then raise exception '結帳交易未完成'; end if;
  v_entry:=public.atomic_redeem_customer_package(
    v_package.id,v_tx.id,v_service.id,'checkout-redemption:'||v_draft.id::text
  );
  return v_bundle||jsonb_build_object('packageRedemptionLedgerId',v_entry::text);
end; $$;

revoke all on function public.settle_checkout_with_package_redemption(text,timestamptz,uuid,uuid)
from public,anon;
grant execute on function public.settle_checkout_with_package_redemption(text,timestamptz,uuid,uuid)
to authenticated;
