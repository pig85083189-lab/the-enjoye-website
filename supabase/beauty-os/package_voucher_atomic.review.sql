-- Reviewed separately before production migration.
create function public.finance_redeem_booking_with_vouchers(
 p_actor_auth_user_id uuid,p_checkout_app_id text,p_expected_updated_at timestamptz,
 p_customer_package_id uuid,p_service_id uuid,p_organization_id uuid,
 p_appointment_app_id text,p_voucher_customer_id uuid,p_tickets jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_voucher_customer_id is null or jsonb_typeof(p_tickets) is distinct from 'array' then raise exception 'INVALID_VOUCHERS'; end if;
 if jsonb_array_length(p_tickets) not between 1 and 100 then raise exception 'INVALID_VOUCHERS'; end if;
 -- Caller must independently resolve the verified voucher customer from the authenticated booking source.
 result:=public.finance_redeem_booking_atomic(p_actor_auth_user_id,p_checkout_app_id,p_expected_updated_at,p_customer_package_id,p_service_id,p_organization_id,p_appointment_app_id);
 perform public.redeem_checkout_vouchers(p_organization_id,p_voucher_customer_id,p_checkout_app_id,p_tickets);
 return result;
end; $$;
revoke all on function public.finance_redeem_booking_with_vouchers(uuid,text,timestamptz,uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finance_redeem_booking_with_vouchers(uuid,text,timestamptz,uuid,uuid,uuid,text,uuid,jsonb) to service_role;
