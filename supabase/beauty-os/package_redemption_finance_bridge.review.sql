-- REVIEW ONLY. Do not apply until zero-value checkout creation and UI are integrated.
-- Finance database: bfzquejrtgqzzarhkiya.
-- A single RPC transaction settles the zero-value checkout and deducts one session.
create or replace function public.finance_package_redemption_bridge(
  p_actor_auth_user_id uuid,
  p_checkout_app_id text,
  p_expected_updated_at timestamptz,
  p_customer_package_id uuid,
  p_service_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_draft public.checkout_drafts;
  v_membership public.staff_auth_memberships;
  v_result jsonb;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
     and (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') is distinct from 'service_role'
  then raise exception 'finance bridge requires service role'; end if;
  if p_actor_auth_user_id is null or p_checkout_app_id is null
     or length(trim(p_checkout_app_id)) < 8 or length(p_checkout_app_id)>128
     or p_expected_updated_at is null or p_customer_package_id is null or p_service_id is null
  then raise exception 'invalid redemption request'; end if;
  -- App ID is organization scoped. Reject ambiguous IDs before selecting a draft.
  if (select count(*) from public.checkout_drafts where app_id=p_checkout_app_id)<>1
  then raise exception 'ambiguous or missing checkout'; end if;
  select * into v_draft from public.checkout_drafts
    where app_id=p_checkout_app_id for update;
  if v_draft.status not in ('OPEN','READY')
     or v_draft.updated_at is distinct from p_expected_updated_at
  then raise exception 'checkout has changed'; end if;
  select m.* into v_membership from public.staff_auth_memberships m
    join public.organizations o on o.app_id=m.organization_id
    left join public.finance_booking_actor_links l on l.finance_membership_id=m.id
    where o.id=v_draft.organization_id
      and (m.auth_user_id=p_actor_auth_user_id or l.booking_auth_user_id=p_actor_auth_user_id)
      and m.is_active=true and m.role in ('OWNER','MANAGER','STAFF','RECEPTIONIST')
      and public.is_operational_staff_id(m.user_id)
    order by case m.role when 'OWNER' then 0 when 'MANAGER' then 1 else 2 end
    limit 1;
  if v_membership.id is null or v_membership.auth_user_id is null
  then raise exception 'finance actor not authorized'; end if;
  if exists (select 1 from public.staff_auth_membership_locations x
             where x.membership_id=v_membership.id)
     and not exists (
       select 1 from public.staff_auth_membership_locations x
       join public.locations loc on loc.app_id=x.location_id
          and loc.organization_id=v_draft.organization_id
       where x.membership_id=v_membership.id and loc.id=v_draft.location_id
     ) then raise exception 'finance branch not authorized'; end if;
  if not exists (select 1 from public.customer_packages cp
      where cp.id=p_customer_package_id
        and cp.organization_id=v_draft.organization_id
        and cp.customer_id=v_draft.customer_id)
     or not exists (select 1 from public.services s
      where s.id=p_service_id and s.organization_id=v_draft.organization_id and s.is_active=true)
  then raise exception 'package, customer or service scope mismatch'; end if;
  -- Only the existing atomic settlement function may create the ledger debit.
  -- It verifies a single zero-value service item, no payments, matching
  -- package selection and service, then settles and redeems in one transaction.
  perform set_config('request.jwt.claim.sub',v_membership.auth_user_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',v_membership.auth_user_id::text,'role','authenticated')::text,true);
  v_result := public.settle_checkout_with_package_redemption(
    p_checkout_app_id,p_expected_updated_at,p_customer_package_id,p_service_id);
  return v_result;
end $$;
revoke all on function public.finance_package_redemption_bridge(uuid,text,timestamptz,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.finance_package_redemption_bridge(uuid,text,timestamptz,uuid,uuid)
  to service_role;

-- Atomic preparation of the ONLY accepted redemption checkout shape.
-- The application must resolve the booking customer through its verified
-- finance customer mapping before passing the finance customer UUID.
-- This routine deliberately does not settle or debit a package.
create or replace function public.finance_prepare_package_redemption_checkout(
  p_actor_auth_user_id uuid,
  p_checkout_app_id text,
  p_organization_app_id text,
  p_location_app_id text,
  p_finance_customer_id uuid,
  p_customer_package_id uuid,
  p_service_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations;
  v_location public.locations;
  v_package public.customer_packages;
  v_service public.services;
  v_membership public.staff_auth_memberships;
  v_draft public.checkout_drafts;
  v_balance bigint;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
    and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role'
  then raise exception 'finance bridge requires service role'; end if;
  if p_actor_auth_user_id is null or p_finance_customer_id is null
     or p_customer_package_id is null or p_service_id is null
     or p_checkout_app_id !~ '^redemption:[a-zA-Z0-9_-]{12,90}$'
     or p_organization_app_id is null or p_location_app_id is null
  then raise exception 'invalid redemption preparation'; end if;
  select * into strict v_org from public.organizations where app_id=p_organization_app_id;
  select * into strict v_location from public.locations
    where organization_id=v_org.id and app_id=p_location_app_id;
  select m.* into v_membership from public.staff_auth_memberships m
    left join public.finance_booking_actor_links l on l.finance_membership_id=m.id
    where m.organization_id=v_org.app_id and m.is_active=true
      and (m.auth_user_id=p_actor_auth_user_id or l.booking_auth_user_id=p_actor_auth_user_id)
      and m.role in ('OWNER','MANAGER','STAFF','RECEPTIONIST')
      and public.is_operational_staff_id(m.user_id)
    order by case m.role when 'OWNER' then 0 when 'MANAGER' then 1 else 2 end
    limit 1;
  if v_membership.id is null or v_membership.auth_user_id is null
  then raise exception 'finance actor not authorized'; end if;
  if exists(select 1 from public.staff_auth_membership_locations where membership_id=v_membership.id)
     and not exists(select 1 from public.staff_auth_membership_locations
        where membership_id=v_membership.id and location_id=v_location.app_id)
  then raise exception 'finance branch not authorized'; end if;
  select * into strict v_package from public.customer_packages
    where id=p_customer_package_id and organization_id=v_org.id
      and customer_id=p_finance_customer_id for update;
  select * into strict v_service from public.services
    where id=p_service_id and organization_id=v_org.id and is_active=true;
  if v_package.status <> 'ACTIVE'
     or (v_package.expires_at is not null and v_package.expires_at <= now())
     or not (v_service.app_id = any(v_package.included_service_ids_snapshot))
  then raise exception 'package not eligible'; end if;
  select coalesce(sum(session_delta),0) into v_balance from public.package_ledger_entries
    where customer_package_id=v_package.id;
  if v_balance < 1 then raise exception 'package has no remaining sessions'; end if;
  -- Retrying a prepared request is safe. Reuse the same draft only when
  -- all identifiers and the zero-value shape match.
  select * into v_draft from public.checkout_drafts
    where app_id=p_checkout_app_id for update;
  if v_draft.id is not null then
    if v_draft.organization_id<>v_org.id or v_draft.location_id<>v_location.id
       or v_draft.customer_id<>p_finance_customer_id
       or v_draft.package_redemption <> jsonb_build_object(
          'customerPackageId',v_package.app_id,'serviceId',v_service.app_id,'sessions',1)
    then raise exception 'checkout id already in use'; end if;
    return jsonb_build_object('checkoutAppId',v_draft.app_id,
      'expectedUpdatedAt',v_draft.updated_at,'status',v_draft.status);
  end if;
  insert into public.checkout_drafts(
    organization_id,location_id,customer_id,app_id,subtotal_minor,
    discount_total_minor,total_minor,currency,status,package_redemption,created_by_staff_id
  ) values(
    v_org.id,v_location.id,p_finance_customer_id,p_checkout_app_id,0,0,0,'TWD','OPEN',
    jsonb_build_object('customerPackageId',v_package.app_id,'serviceId',v_service.app_id,'sessions',1),
    v_membership.user_id
  ) returning * into v_draft;
  insert into public.checkout_items(
    organization_id,checkout_draft_id,app_id,type,reference_id,name_snapshot,
    unit_price_minor,quantity,line_subtotal_minor,discount_amount_minor,line_total_minor,sort_order
  ) values(
    v_org.id,v_draft.id,p_checkout_app_id||':service','SERVICE',v_service.app_id,
    v_service.name,0,1,0,0,0,0
  );
  return jsonb_build_object('checkoutAppId',v_draft.app_id,
    'expectedUpdatedAt',v_draft.updated_at,'status',v_draft.status);
end $$;
revoke all on function public.finance_prepare_package_redemption_checkout(
  uuid,text,text,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finance_prepare_package_redemption_checkout(
  uuid,text,text,text,uuid,uuid,uuid) to service_role;
