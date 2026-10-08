-- =============================================================================
-- Beauty OS — Staff login invite create / resend (Phase 2B-2)
-- Additive only. Does not rewrite 20261008120000 bind/revoke foundation.
--
-- Owner-only SECURITY DEFINER insert/refresh of staff_login_invites.
-- Does not create Staff. Does not bind auth_user_id. Does not send email.
-- Authenticated clients still have no INSERT/UPDATE grant on invites.
-- =============================================================================

create or replace function public.create_staff_login_invite(
  p_membership_id text,
  p_email text,
  p_invited_auth_user_id uuid,
  p_expires_at timestamptz,
  p_existing_invite_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_actor public.staff_auth_memberships%rowtype;
  v_membership public.staff_auth_memberships%rowtype;
  v_invite public.staff_login_invites%rowtype;
  v_id text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_membership_id is null or p_membership_id not like 'mem-%' then
    raise exception 'invalid membership' using errcode = '22023';
  end if;
  if v_email is null or position('@' in v_email) = 0 then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  -- Persist-first may insert pending with a null Auth UUID, then attach after send.
  -- Never delete Auth users from this function.
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'invalid expiry' using errcode = '22023';
  end if;

  select * into v_membership
  from public.staff_auth_memberships
  where id = p_membership_id
  for update;

  if not found then
    raise exception 'invalid membership' using errcode = '22023';
  end if;

  select * into v_actor
  from public.staff_auth_memberships
  where auth_user_id = v_uid
    and organization_id = v_membership.organization_id
    and is_active = true
    and role = 'OWNER'
  limit 1;

  if not found then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not public.is_operational_staff_id(v_actor.user_id) then
    raise exception 'invalid actor' using errcode = '42501';
  end if;
  if v_membership.is_active is not true then
    raise exception 'inactive membership' using errcode = '42501';
  end if;
  if v_membership.auth_user_id is not null then
    raise exception 'already bound' using errcode = '23505';
  end if;
  if not public.is_operational_staff_id(v_membership.user_id) then
    raise exception 'invalid staff id' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(v_membership.email, ''))) is distinct from v_email then
    raise exception 'email mismatch' using errcode = '42501';
  end if;

  update public.staff_login_invites
  set status = 'expired'
  where membership_id = v_membership.id
    and status = 'pending'
    and expires_at <= now();

  -- Serialize concurrent create / resend / attach on this membership.
  select * into v_invite
  from public.staff_login_invites
  where membership_id = v_membership.id
    and status = 'pending'
  for update;

  if p_existing_invite_id is not null then
    if not found
       or v_invite.id is distinct from p_existing_invite_id
       or v_invite.organization_id is distinct from v_membership.organization_id
       or v_invite.status is distinct from 'pending'
       or v_invite.expires_at <= now() then
      raise exception 'invalid invite' using errcode = '22023';
    end if;
    if v_invite.invited_auth_user_id is not null
       and p_invited_auth_user_id is not null
       and v_invite.invited_auth_user_id is distinct from p_invited_auth_user_id then
      raise exception 'invite auth mismatch' using errcode = '42501';
    end if;

    update public.staff_login_invites
    set
      email = v_email,
      invited_auth_user_id = coalesce(p_invited_auth_user_id, v_invite.invited_auth_user_id),
      expires_at = p_expires_at
    where id = v_invite.id
      and status = 'pending';

    return jsonb_build_object(
      'invite_id', v_invite.id,
      'membership_id', v_membership.id,
      'user_id', v_membership.user_id,
      'organization_id', v_membership.organization_id,
      'status', 'pending',
      'mode', 'resend'
    );
  end if;

  if found then
    raise exception 'pending invite exists' using errcode = '23505';
  end if;

  v_id := 'inv-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  begin
    insert into public.staff_login_invites (
      id,
      membership_id,
      organization_id,
      email,
      invited_auth_user_id,
      status,
      expires_at,
      invited_by_staff_id
    ) values (
      v_id,
      v_membership.id,
      v_membership.organization_id,
      v_email,
      p_invited_auth_user_id,
      'pending',
      p_expires_at,
      v_actor.user_id
    );
  exception
    when unique_violation then
      raise exception 'pending invite exists' using errcode = '23505';
  end;

  return jsonb_build_object(
    'invite_id', v_id,
    'membership_id', v_membership.id,
    'user_id', v_membership.user_id,
    'organization_id', v_membership.organization_id,
    'status', 'pending',
    'mode', 'invite'
  );
end;
$$;

comment on function public.create_staff_login_invite(text, text, uuid, timestamptz, text) is
  'Owner-only persist-first create / attach / refresh of a pending Staff login invite. Null invited_auth_user_id is allowed until Auth send attaches. Does not create Staff, bind membership.auth_user_id, or delete Auth users.';

revoke all on function public.create_staff_login_invite(text, text, uuid, timestamptz, text)
  from public, anon;
grant execute on function public.create_staff_login_invite(text, text, uuid, timestamptz, text)
  to authenticated;

revoke insert, update, delete on public.staff_login_invites from authenticated, anon, public;
revoke update on public.staff_auth_memberships from authenticated, anon, public;
