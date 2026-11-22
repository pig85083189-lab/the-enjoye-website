-- Read an authenticated package-sale checkout without appointment/treatment hydration.
create or replace function public.get_package_purchase_checkout(p_checkout_app_id text)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_draft public.checkout_drafts;
begin
  if auth.uid() is null then raise exception '沒有權限讀取結帳單'; end if;
  if nullif(trim(coalesce(p_checkout_app_id,'')),'') is null then
    raise exception '結帳識別碼無效';
  end if;
  select * into v_draft from public.checkout_drafts
    where app_id=p_checkout_app_id;
  if v_draft.id is null then raise exception '找不到結帳單'; end if;
  perform public.assert_commerce_checkout_actor(v_draft.organization_id,v_draft.location_id);
  if (select count(*) from public.checkout_items
      where checkout_draft_id=v_draft.id)<>1
    or not exists (select 1 from public.checkout_items
      where checkout_draft_id=v_draft.id and type='PACKAGE_PURCHASE')
  then raise exception '不是套票購買結帳單'; end if;
  return public.commerce_checkout_bundle(v_draft);
end; $$;
revoke all on function public.get_package_purchase_checkout(text) from public,anon;
grant execute on function public.get_package_purchase_checkout(text) to authenticated;
