-- Opt-in atomic checkout with one session redemption.
-- Existing checkout, payments and UI remain untouched.
-- The service must be a zero-priced line: the session is the consideration,
-- not a PACKAGE payment method (which the legacy settlement rejects).
create or replace function public.settle_checkout_with_package_redemption(
  p_checkout_app_id text,
  p_expected_updated_at timestamptz,
  p_customer_package_id uuid,
  p_service_id uuid
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_draft public.checkout_drafts;
  v_package public.customer_packages;
  v_service public.services;
  v_tx public.transactions;
  v_bundle jsonb;
  v_entry uuid;
  v_service_items integer;
begin
  if auth.uid() is null then raise exception '沒有權限結帳'; end if;
  select * into v_draft from public.checkout_drafts
    where app_id=p_checkout_app_id for update;
  if v_draft.id is null then raise exception '找不到結帳資料'; end if;
  perform public.assert_commerce_checkout_actor(v_draft.organization_id,v_draft.location_id);
  if v_draft.status not in ('OPEN','READY') or
     v_draft.updated_at is distinct from p_expected_updated_at then
    raise exception '結帳資料已更新或無法扣堂，請重新整理';
  end if;
  if v_draft.customer_id is null then raise exception '扣堂必須指定顧客'; end if;

  -- Keep lock order aligned with atomic_redeem_customer_package:
  -- transaction first, package second. Prevents cross-checkout deadlocks.
  -- No transaction exists yet for a new draft, so avoid pre-locking the
  -- package here; the atomic ledger helper will lock it after settlement.
  select * into v_package from public.customer_packages
    where id=p_customer_package_id and organization_id=v_draft.organization_id;
  if v_package.id is null or v_package.customer_id is distinct from v_draft.customer_id
  then raise exception '套票與結帳顧客不符'; end if;
  select * into v_service from public.services
    where id=p_service_id and organization_id=v_draft.organization_id;
  if v_service.id is null or not (v_service.app_id = any(v_package.included_service_ids_snapshot))
  then raise exception '套票不適用此療程'; end if;

  -- Explicit zero-value service checkout, never treat a normal paid
  -- checkout as a session redemption. Forbid mixed carts until supported.
  select count(*) into v_service_items from public.checkout_items i
    where i.checkout_draft_id=v_draft.id and i.type='SERVICE'
      and i.reference_id=v_service.app_id
      and i.quantity=1 and i.line_total_minor=0
      and i.line_subtotal_minor=0
      and i.unit_price_minor=0 and i.discount_amount_minor=0;
  if v_service_items<>1
    or (select count(*) from public.checkout_items where checkout_draft_id=v_draft.id)<>1
    or exists (select 1 from public.checkout_payments where checkout_draft_id=v_draft.id)
    or exists (select 1 from public.checkout_discounts where checkout_draft_id=v_draft.id)
    or v_draft.subtotal_minor<>0 or v_draft.discount_total_minor<>0
    or v_draft.total_minor<>0
  then raise exception '套票扣堂結帳必須只有一筆零元指定療程'; end if;

  -- PostgreSQL function calls share the outer statement transaction.
  -- Any redemption error rolls back the settlement insert/update.
  v_bundle := public.settle_checkout_draft(p_checkout_app_id,p_expected_updated_at);
  select * into v_tx from public.transactions
    where checkout_draft_id=v_draft.id and organization_id=v_draft.organization_id
      and status='COMPLETED' for update;
  if v_tx.id is null then raise exception '找不到已完成結帳交易'; end if;
  v_entry := public.atomic_redeem_customer_package(
    v_package.id,v_tx.id,v_service.id,'checkout-redemption:'||v_draft.id::text
  );
  return v_bundle || jsonb_build_object('packageRedemptionLedgerId',v_entry::text);
end; $$;

revoke all on function public.settle_checkout_with_package_redemption(text,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.settle_checkout_with_package_redemption(text,timestamptz,uuid,uuid) to authenticated;
comment on function public.settle_checkout_with_package_redemption(text,timestamptz,uuid,uuid)
is 'Opt-in atomic zero-value service checkout and one package redemption; not yet wired to UI.';
