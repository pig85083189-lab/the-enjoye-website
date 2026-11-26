alter table public.checkout_voucher_redemptions add column if not exists actor_auth_user_id uuid;
grant update(actor_auth_user_id) on public.checkout_voucher_redemptions to service_role;
create or replace function public.finance_manual_redeem_voucher(p_org uuid,p_customer uuid,p_actor uuid,p_source text,p_voucher uuid) returns integer language plpgsql security invoker set search_path='' as $$
declare k text := 'manual:'||gen_random_uuid()::text; n integer;
begin
 if p_actor is null then raise exception 'ACTOR_REQUIRED'; end if;
 n:=public.redeem_checkout_vouchers(p_org,p_customer,k,jsonb_build_array(jsonb_build_object('source',p_source,'id',p_voucher)));
 update public.checkout_voucher_redemptions set actor_auth_user_id=p_actor where organization_id=p_org and customer_id=p_customer and checkout_app_id=k;
 return n;
end; $$;
revoke all on function public.finance_manual_redeem_voucher(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.finance_manual_redeem_voucher(uuid,uuid,uuid,text,uuid) to service_role;
