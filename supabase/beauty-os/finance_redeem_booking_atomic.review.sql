create or replace function public.finance_redeem_booking_atomic(p_actor_auth_user_id uuid,p_checkout_app_id text,p_expected_updated_at timestamptz,p_customer_package_id uuid,p_service_id uuid,p_organization_id uuid,p_appointment_app_id text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.checkout_drafts; t public.transactions; result jsonb;
begin
if coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') is distinct from 'service_role' then raise exception 'service role required'; end if;
if p_organization_id is null or p_appointment_app_id is null or p_appointment_app_id !~ '^apt-[A-Za-z0-9_-]{5,100}$' then raise exception 'invalid booking'; end if;
perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_appointment_app_id,0));
if exists(select 1 from public.package_redemption_booking_links where organization_id=p_organization_id and booking_appointment_app_id=p_appointment_app_id) then raise exception 'booking already redeemed'; end if;
select * into strict d from public.checkout_drafts where organization_id=p_organization_id and app_id=p_checkout_app_id for update;
result:=public.finance_package_redemption_bridge(p_actor_auth_user_id,p_checkout_app_id,p_expected_updated_at,p_customer_package_id,p_service_id);
select * into strict t from public.transactions where checkout_draft_id=d.id and organization_id=p_organization_id and status='COMPLETED';
insert into public.package_redemption_booking_links(transaction_id,organization_id,booking_appointment_app_id) values(t.id,p_organization_id,p_appointment_app_id);
return result;
end $$;
revoke all on function public.finance_redeem_booking_atomic(uuid,text,timestamptz,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finance_redeem_booking_atomic(uuid,text,timestamptz,uuid,uuid,uuid,text) to service_role;