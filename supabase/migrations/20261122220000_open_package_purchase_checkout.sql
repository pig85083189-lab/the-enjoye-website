-- Dedicated authenticated package-sale draft creation.
-- This does not change generic checkout or touch existing customer balances.
create or replace function public.open_package_purchase_checkout(
  p_checkout_app_id text,
  p_customer_app_id text,
  p_location_app_id text,
  p_package_definition_app_id text
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_org uuid;
  v_customer public.customers;
  v_location public.locations;
  v_def public.package_definitions;
  v_draft public.checkout_drafts;
  v_staff text;
begin
  if auth.uid() is null then raise exception '沒有權限建立套票結帳'; end if;
  if nullif(trim(coalesce(p_checkout_app_id,'')),'') is null
     or length(p_checkout_app_id)>128 then raise exception '結帳識別碼無效'; end if;
  select * into v_location from public.locations
    where app_id=p_location_app_id and is_active=true;
  if v_location.id is null then raise exception '找不到有效分店'; end if;
  v_org:=v_location.organization_id;
  v_staff:=public.assert_commerce_checkout_actor(v_org,v_location.id);
  select * into v_customer from public.customers
    where organization_id=v_org and app_id=p_customer_app_id;
  if v_customer.id is null then raise exception '顧客尚未同步至正式資料庫'; end if;
  select * into v_def from public.package_definitions
    where organization_id=v_org and app_id=p_package_definition_app_id and is_active=true;
  if v_def.id is null or v_def.session_count<1 or v_def.price_minor<=0
     or jsonb_typeof(v_def.included_services)<>'array'
     or jsonb_array_length(v_def.included_services)=0
  then raise exception '套票方案尚未同步或無效'; end if;

  select * into v_draft from public.checkout_drafts
    where organization_id=v_org and app_id=p_checkout_app_id for update;
  if v_draft.id is not null then
    if v_draft.customer_id is distinct from v_customer.id
       or v_draft.location_id is distinct from v_location.id
       or v_draft.status not in ('OPEN','READY')
       or (select count(*) from public.checkout_items where checkout_draft_id=v_draft.id)<>1
       or not exists (select 1 from public.checkout_items
           where checkout_draft_id=v_draft.id and type='PACKAGE_PURCHASE'
             and reference_id=v_def.app_id and quantity=1
             and unit_price_minor=v_def.price_minor
             and session_count_snapshot=v_def.session_count)
       or exists (select 1 from public.checkout_payments where checkout_draft_id=v_draft.id)
       or exists (select 1 from public.checkout_discounts where checkout_draft_id=v_draft.id)
    then raise exception '結帳識別碼已被使用'; end if;
    return public.commerce_checkout_bundle(v_draft);
  end if;

  insert into public.checkout_drafts
    (organization_id,location_id,customer_id,app_id,
     subtotal_minor,discount_total_minor,total_minor,created_by_staff_id)
  values (v_org,v_location.id,v_customer.id,p_checkout_app_id,
          v_def.price_minor,0,v_def.price_minor,v_staff)
  returning * into v_draft;

  insert into public.checkout_items
    (organization_id,checkout_draft_id,app_id,type,reference_id,name_snapshot,
     unit_price_minor,quantity,line_subtotal_minor,discount_amount_minor,
     line_total_minor,session_count_snapshot,sort_order)
  values (v_org,v_draft.id,p_checkout_app_id||':package','PACKAGE_PURCHASE',
          v_def.app_id,v_def.name,v_def.price_minor,1,v_def.price_minor,0,
          v_def.price_minor,v_def.session_count,0);
  return public.commerce_checkout_bundle(v_draft);
end; $$;
revoke all on function public.open_package_purchase_checkout(text,text,text,text) from public,anon;
grant execute on function public.open_package_purchase_checkout(text,text,text,text) to authenticated;
