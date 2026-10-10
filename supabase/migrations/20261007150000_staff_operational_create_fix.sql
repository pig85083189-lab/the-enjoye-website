-- =============================================================================
-- Beauty OS — Staff CREATE V1 fix (atomic operational create)
-- Migration: 20261007150000_staff_operational_create_fix.sql
--
-- Additive. Does not rewrite 20261007140000.
-- Authenticated RPC creates membership + location assignment in one
-- transaction. No Auth user, invite, password, or service-role write.
-- =============================================================================

create or replace function public.create_operational_staff(
  p_membership_id text,
  p_user_id text,
  p_display_name text,
  p_role text,
  p_location_ids text[],
  p_phone text default null,
  p_email text default null,
  p_title text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_uuid uuid;
  v_org_app text;
  v_actor text;
  v_loc text;
  v_existing public.staff_auth_memberships%rowtype;
  v_locations text[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_membership_id is null
     or length(btrim(p_membership_id)) = 0
     or public.is_auth_uuid(p_membership_id)
     or p_membership_id not like 'mem-%' then
    raise exception 'invalid membership id' using errcode = '22023';
  end if;
  if p_user_id is null
     or not public.is_operational_staff_id(p_user_id)
     or public.is_auth_uuid(p_user_id)
     or p_user_id not like 'staff-%' then
    raise exception 'invalid operational staff id' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('MANAGER', 'STAFF', 'RECEPTIONIST', 'ACCOUNTANT') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if p_display_name is null or length(btrim(p_display_name)) = 0 then
    raise exception 'invalid display name' using errcode = '22023';
  end if;
  if p_location_ids is null or coalesce(array_length(p_location_ids, 1), 0) = 0 then
    raise exception 'location required' using errcode = '22023';
  end if;

  select o.id, o.app_id, public.user_operational_staff_id(o.id)
    into v_org_uuid, v_org_app, v_actor
  from public.staff_auth_memberships m
  join public.organizations o on o.app_id = m.organization_id
  where m.auth_user_id = auth.uid()
    and m.is_active = true
  order by case m.role
    when 'OWNER' then 0
    when 'MANAGER' then 1
    else 2
  end
  limit 1;

  if v_org_uuid is null or v_actor is null or v_org_app is null then
    raise exception 'no managerial membership' using errcode = '42501';
  end if;
  if not public.user_has_org_membership(v_org_uuid) then
    raise exception 'no org membership' using errcode = '42501';
  end if;
  if not public.staff_role_is_managerial(public.user_org_role(v_org_uuid)) then
    raise exception 'not managerial' using errcode = '42501';
  end if;
  if not public.is_operational_staff_id(v_actor) then
    raise exception 'invalid actor' using errcode = '42501';
  end if;

  for v_loc in
    select distinct trim(both from loc)
    from unnest(p_location_ids) as loc
  loop
    if v_loc is null or v_loc = '' or public.is_auth_uuid(v_loc) then
      raise exception 'invalid location' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.locations l
      where l.app_id = v_loc
        and l.organization_id = v_org_uuid
        and public.user_can_access_location(v_org_uuid, l.id)
    ) then
      raise exception 'invalid location' using errcode = '22023';
    end if;
  end loop;

  select *
    into v_existing
  from public.staff_auth_memberships
  where id = p_membership_id
     or (organization_id = v_org_app and user_id = p_user_id)
  limit 1;

  if found then
    if v_existing.auth_user_id is not null
       or v_existing.user_id is distinct from p_user_id
       or v_existing.organization_id is distinct from v_org_app
       or v_existing.id is distinct from p_membership_id then
      raise exception 'duplicate staff' using errcode = '23505';
    end if;
  else
    insert into public.staff_auth_memberships (
      id,
      user_id,
      auth_user_id,
      organization_id,
      role,
      display_name,
      email,
      phone,
      title,
      is_active,
      created_by_staff_id
    ) values (
      p_membership_id,
      p_user_id,
      null,
      v_org_app,
      p_role,
      btrim(p_display_name),
      nullif(btrim(coalesce(p_email, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_title, '')), ''),
      true,
      v_actor
    )
    returning * into v_existing;
  end if;

  for v_loc in
    select distinct trim(both from loc)
    from unnest(p_location_ids) as loc
  loop
    insert into public.staff_auth_membership_locations (membership_id, location_id)
    values (v_existing.id, v_loc)
    on conflict (membership_id, location_id) do nothing;
  end loop;

  select coalesce(array_agg(location_id order by location_id), '{}')
    into v_locations
  from public.staff_auth_membership_locations
  where membership_id = v_existing.id;

  if coalesce(array_length(v_locations, 1), 0) = 0 then
    raise exception 'location assignment failed' using errcode = '23502';
  end if;

  return jsonb_build_object(
    'id', v_existing.id,
    'user_id', v_existing.user_id,
    'auth_user_id', v_existing.auth_user_id,
    'organization_id', v_existing.organization_id,
    'role', v_existing.role,
    'display_name', v_existing.display_name,
    'email', v_existing.email,
    'phone', v_existing.phone,
    'title', v_existing.title,
    'is_active', v_existing.is_active,
    'created_at', v_existing.created_at,
    'created_by_staff_id', v_existing.created_by_staff_id,
    'location_ids', to_jsonb(v_locations)
  );
end;
$$;

comment on function public.create_operational_staff(
  text, text, text, text, text[], text, text, text
) is
  'Staff CREATE V1 atomic operational insert. auth_user_id stays null. Actor is derived from auth.uid().';

revoke all on function public.create_operational_staff(
  text, text, text, text, text[], text, text, text
) from public, anon;
grant execute on function public.create_operational_staff(
  text, text, text, text, text[], text, text, text
) to authenticated;

grant select, insert on public.staff_auth_memberships to authenticated;
grant select, insert on public.staff_auth_membership_locations to authenticated;
