-- REVIEW ONLY. Do not apply until isolated integration tests and release approval.
-- This function is a narrow service-role-only bridge to existing finance RPCs.
-- The calling Next.js server MUST independently validate its booking-side session
-- and cross-check the staff, customer, package and LINE membership.
-- No finance keys or RPC access are exposed to browser code.
begin;
create table if not exists public.finance_booking_actor_links (
  booking_auth_user_id uuid primary key,
  finance_membership_id uuid not null unique references public.staff_auth_memberships(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.finance_booking_actor_links enable row level security;
revoke all on public.finance_booking_actor_links from public, anon, authenticated;
grant select on public.finance_booking_actor_links to service_role;

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
  v_payment jsonb;
  v_payment_sum numeric := 0;
  v_payment_methods text[] := array[]::text[];
  v_checkout_matches integer;
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
    select l.organization_id,l.id into strict v_org,v_location
      from public.locations l where l.app_id=p_location_app_id and l.is_active=true;
  elsif p_action in ('SAVE','SETTLE') then
    if p_customer_app_id is not null or p_location_app_id is not null
       or p_package_definition_app_id is not null or p_expected_updated_at is null
    then raise exception 'invalid update arguments'; end if;
    -- Checkout app_id is unique per organization, not globally.
    -- Refuse ambiguous IDs instead of choosing a different tenant's draft.
    select count(*) into v_checkout_matches from public.checkout_drafts
      where app_id=p_checkout_app_id;
    if v_checkout_matches <> 1 then raise exception 'ambiguous or missing checkout identity'; end if;
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
    left join public.finance_booking_actor_links actor_link on actor_link.finance_membership_id=m.id
    where o.id=v_org and (m.auth_user_id=p_actor_auth_user_id or actor_link.booking_auth_user_id=p_actor_auth_user_id)
      and m.is_active=true and m.role in ('OWNER','MANAGER','STAFF','RECEPTIONIST')
      and public.is_operational_staff_id(m.user_id)
    order by case m.role when 'OWNER' then 0 when 'MANAGER' then 1 else 2 end
    limit 1;
  if v_membership.id is null or v_membership.auth_user_id is null then raise exception 'finance actor not authorized'; end if;
  if exists (select 1 from public.staff_auth_membership_locations x
             where x.membership_id=v_membership.id)
     and not exists (
       select 1 from public.staff_auth_membership_locations x
       join public.locations l on l.app_id=x.location_id and l.organization_id=v_org
       where x.membership_id=v_membership.id and l.id=v_location)
  then raise exception 'finance branch not authorized'; end if;

  if p_action in ('SAVE','SETTLE') then
    -- A package purchase is exactly one package line, with no discounts.
    -- Prevent arbitrary checkout drafts from being modified through this bridge.
    if v_checkout.status not in ('OPEN','READY')
       or v_checkout.updated_at is distinct from p_expected_updated_at
       or (select count(*) from public.checkout_items i
           where i.checkout_draft_id=v_checkout.id) <> 1
       or not exists (select 1 from public.checkout_items i
           where i.checkout_draft_id=v_checkout.id
             and i.type='PACKAGE_PURCHASE' and i.quantity=1)
       or exists (select 1 from public.checkout_discounts d
           where d.checkout_draft_id=v_checkout.id)
    then raise exception 'invalid package checkout state'; end if;
  end if;
  if p_action='SAVE' then
    if jsonb_array_length(p_payments) < 1 or jsonb_array_length(p_payments) > 4
    then raise exception 'invalid tender count'; end if;
    for v_payment in select value from jsonb_array_elements(p_payments) loop
      if jsonb_typeof(v_payment) <> 'object' then
        raise exception 'invalid package payment object';
      end if;
      if exists (select 1 from jsonb_object_keys(v_payment) k
                    where k not in ('method','amount','reference','id'))
         or (v_payment ? 'reference' and (
               jsonb_typeof(v_payment->'reference') <> 'string'
               or length(v_payment->>'reference') > 128))
         or (v_payment ? 'id' and (
               jsonb_typeof(v_payment->'id') <> 'string'
               or length(v_payment->>'id') > 128))
         or (v_payment->>'method') not in ('CASH','CARD','TRANSFER','OTHER')
         or jsonb_typeof(v_payment->'amount') <> 'number'
         or (v_payment->>'amount') !~ '^[0-9]+$'
         or (v_payment->>'amount')::numeric <= 0
         or (v_payment->>'amount')::numeric > 9223372036854775807
         or (v_payment->>'method') = any(v_payment_methods)
      then raise exception 'invalid package payment'; end if;
      v_payment_methods := array_append(v_payment_methods,v_payment->>'method');
      v_payment_sum := v_payment_sum + (v_payment->>'amount')::numeric;
      if v_payment_sum > v_checkout.total_minor
      then raise exception 'package payment exceeds total'; end if;
    end loop;
    if v_payment_sum is distinct from v_checkout.total_minor
    then raise exception 'package payment does not match total'; end if;
  end if;
  -- SETTLE must re-check persisted payments under the same row lock.
  -- A previously saved draft is not proof that its payments remain valid.
  if p_action='SETTLE' then
    if (select count(*) from public.checkout_payments p
        where p.checkout_draft_id=v_checkout.id) not between 1 and 4
       or exists (
         select 1 from public.checkout_payments p
         where p.checkout_draft_id=v_checkout.id
           and (p.method::text not in ('CASH','CARD','TRANSFER','OTHER')
                or p.amount_minor <= 0))
       or exists (
         select 1 from public.checkout_payments p
         where p.checkout_draft_id=v_checkout.id
         group by p.method having count(*) > 1)
       or (select coalesce(sum(p.amount_minor),0)
           from public.checkout_payments p
           where p.checkout_draft_id=v_checkout.id) <> v_checkout.total_minor
    then raise exception 'invalid settled package tenders'; end if;
  end if;
  -- Restrict transaction scope to the package definition's organization.
  if p_action='SETTLE' and not exists (
    select 1 from public.package_definitions d
    where d.id=p_package_definition_id and d.organization_id=v_org and d.is_active=true
  ) then raise exception 'invalid package definition scope'; end if;

  -- Transaction-local identity is used ONLY inside this privileged bridge.
  -- Existing finance RPCs re-check the actual finance membership and branch.
  perform set_config('request.jwt.claim.sub',v_membership.auth_user_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',v_membership.auth_user_id::text,'role','authenticated')::text,true);
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
