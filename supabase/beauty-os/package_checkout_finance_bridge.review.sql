-- REVIEW ONLY. Do not apply until isolated integration tests and release approval.
-- This function is a narrow service-role-only bridge to existing finance RPCs.
-- The calling Next.js server MUST independently validate its booking-side session
-- and cross-check the staff, customer, package and LINE membership.
-- No finance keys or RPC access are exposed to browser code.
begin;
create or replace function public.finance_package_checkout_bridge(
  p_action text,
  p_actor_auth_user_id uuid,
  p_checkout_app_id text,
  p_customer_app_id text default null,
  p_location_app_id text default null,
  p_package_definition_app_id text default null,
  p_expected_updated_at timestamptz default null,
  p_payments jsonb default null,
  p_package_definition_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_location uuid;
  v_checkout public.checkout_drafts;
  v_membership public.staff_auth_memberships;
  v_result jsonb;
begin
  -- Defense in depth: PostgREST must have authenticated the server key.
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role') is distinct from 'service_role'
  then raise exception 'finance bridge requires service role'; end if;
  if p_actor_auth_user_id is null or nullif(trim(coalesce(p_checkout_app_id,'')),'') is null
     or length(p_checkout_app_id)>128 then raise exception 'invalid checkout identity'; end if;
  if p_action = 'OPEN' then
    if p_customer_app_id is null or p_location_app_id is null
       or p_package_definition_app_id is null
       or p_expected_updated_at is not null or p_payments is not null
       or p_package_definition_id is not null
    then raise exception 'invalid open arguments'; end if;
    select l.organization_id,l.id into v_org,v_location
      from public.locations l where l.app_id=p_location_app_id and l.is_active=true;
  elsif p_action in ('SAVE','SETTLE') then
    if p_customer_app_id is not null or p_location_app_id is not null
       or p_package_definition_app_id is not null or p_expected_updated_at is null
    then raise exception 'invalid update arguments'; end if;
    select * into v_checkout from public.checkout_drafts
      where app_id=p_checkout_app_id for update;
    v_org:=v_checkout.organization_id;
    v_location:=v_checkout.location_id;
    if p_action='SAVE' and (p_package_definition_id is not null or p_payments is null
      or jsonb_typeof(p_payments)<>'array') then raise exception 'invalid save arguments'; end if;
    if p_action='SETTLE' and (p_package_definition_id is null or p_payments is not null)
      then raise exception 'invalid settle arguments'; end if;
  else raise exception 'unsupported finance action'; end if;
  if v_org is null or v_location is null then raise exception 'unknown checkout location'; end if;
  select m.* into v_membership from public.staff_auth_memberships m
    join public.organizations o on o.app_id=m.organization_id
    where o.id=v_org and m.auth_user_id=p_actor_auth_user_id
      and m.is_active=true and m.role in ('OWNER','MANAGER','STAFF','RECEPTIONIST')
      and public.is_operational_staff_id(m.user_id)
    order by case m.role when 'OWNER' then 0 when 'MANAGER' then 1 else 2 end
    limit 1;
  if v_membership.id is null then raise exception 'finance actor not authorized'; end if;
  if exists (select 1 from public.staff_auth_membership_locations x
             where x.membership_id=v_membership.id)
     and not exists (
       select 1 from public.staff_auth_membership_locations x
       join public.locations l on l.app_id=x.location_id and l.organization_id=v_org
       where x.membership_id=v_membership.id and l.id=v_location)
  then raise exception 'finance branch not authorized'; end if;

  -- Transaction-local identity is used ONLY inside this privileged bridge.
  -- Existing finance RPCs re-check the actual finance membership and branch.
  perform set_config('request.jwt.claim.sub',p_actor_auth_user_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',p_actor_auth_user_id::text,'role','authenticated')::text,true);
  if p_action='OPEN' then
    v_result:=public.open_package_purchase_checkout(
      p_checkout_app_id,p_customer_app_id,p_location_app_id,p_package_definition_app_id);
  elsif p_action='SAVE' then
    v_result:=public.save_checkout_draft(
      p_checkout_app_id,p_expected_updated_at,p_payments,'[]'::jsonb);
  else
    v_result:=public.settle_checkout_with_package_purchase(
      p_checkout_app_id,p_expected_updated_at,p_package_definition_id);
  end if;
  return v_result;
end;
$$;
revoke all on function public.finance_package_checkout_bridge(
  text,uuid,text,text,text,text,timestamptz,jsonb,uuid
) from public, anon, authenticated;
grant execute on function public.finance_package_checkout_bridge(
  text,uuid,text,text,text,text,timestamptz,jsonb,uuid
) to service_role;
commit;
