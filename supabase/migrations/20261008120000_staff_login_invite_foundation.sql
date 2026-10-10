-- =============================================================================
-- Beauty OS — Staff login invite security foundation (Phase 2B-1)
-- Additive only. Does not rewrite operational CREATE or identity tables.
--
-- Invite identity is public.staff_login_invites.id (inv-*).
-- Claim requires invite row + invited_auth_user_id = auth.uid() + email + org
-- + membership + pending/unexpired. Client-editable Auth metadata is not authoritative.
--
-- Late bind: membership.auth_user_id may change only from NULL to auth.uid().
-- No full-table UPDATE/DELETE grants. No second operational Staff row.
-- =============================================================================

create table if not exists public.staff_login_invites (
  id text primary key,
  membership_id text not null references public.staff_auth_memberships (id) on delete cascade,
  organization_id text not null,
  email text not null,
  invited_auth_user_id uuid,
  status text not null default 'pending',
  expires_at timestamptz not null,
  invited_by_staff_id text not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint staff_login_invites_id_prefix
    check (id like 'inv-%'),
  constraint staff_login_invites_status_check
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  constraint staff_login_invites_inviter_operational
    check (public.is_operational_staff_id(invited_by_staff_id)),
  constraint staff_login_invites_email_normalized
    check (email = lower(btrim(email)))
);

comment on table public.staff_login_invites is
  'Server-controlled Staff login invites. Claim uses invite id + invited_auth_user_id, never client-editable Auth metadata.';

create unique index if not exists staff_login_invites_one_pending_membership
  on public.staff_login_invites (membership_id)
  where status = 'pending';

create unique index if not exists staff_login_invites_one_pending_auth
  on public.staff_login_invites (invited_auth_user_id)
  where status = 'pending' and invited_auth_user_id is not null;

create index if not exists staff_login_invites_membership_id_idx
  on public.staff_login_invites (membership_id);

alter table public.staff_login_invites enable row level security;

revoke all on public.staff_login_invites from anon, authenticated, public;
grant select on public.staff_login_invites to authenticated;

drop policy if exists staff_login_invites_select_own_or_owner
  on public.staff_login_invites;
create policy staff_login_invites_select_own_or_owner
on public.staff_login_invites
for select
to authenticated
using (
  invited_auth_user_id = auth.uid()
  or exists (
    select 1
    from public.staff_auth_memberships m
    join public.organizations o on o.app_id = m.organization_id
    where m.auth_user_id = auth.uid()
      and m.is_active = true
      and m.role = 'OWNER'
      and m.organization_id = staff_login_invites.organization_id
      and public.user_has_org_membership(o.id)
  )
);

-- Authenticated clients must not PATCH auth_user_id. Bind/revoke are
-- SECURITY DEFINER RPCs with auth.uid() checks. No table UPDATE grants.
revoke update on public.staff_auth_memberships from authenticated, anon, public;
drop policy if exists staff_auth_memberships_bind_invited
  on public.staff_auth_memberships;

create or replace function public.bind_invited_staff_auth_user(p_invite_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_invite public.staff_login_invites%rowtype;
  v_membership public.staff_auth_memberships%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_invite_id is null or p_invite_id not like 'inv-%' then
    raise exception 'invalid invite' using errcode = '22023';
  end if;

  select * into v_invite
  from public.staff_login_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  if v_invite.status is distinct from 'pending' or v_invite.expires_at <= now() then
    raise exception 'invite expired' using errcode = '22023';
  end if;
  if v_invite.invited_auth_user_id is null or v_invite.invited_auth_user_id is distinct from v_uid then
    raise exception 'invite not owned' using errcode = '42501';
  end if;
  if v_invite.email is distinct from v_email then
    raise exception 'email mismatch' using errcode = '42501';
  end if;

  select * into v_membership
  from public.staff_auth_memberships
  where id = v_invite.membership_id
  for update;

  if not found then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  if v_membership.organization_id is distinct from v_invite.organization_id then
    raise exception 'cross organization' using errcode = '42501';
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
  if lower(btrim(coalesce(v_membership.email, ''))) is distinct from v_invite.email then
    raise exception 'email mismatch' using errcode = '42501';
  end if;

  update public.staff_auth_memberships
  set auth_user_id = v_uid
  where id = v_membership.id
    and auth_user_id is null
    and organization_id = v_invite.organization_id;

  if not found then
    raise exception 'already bound' using errcode = '23505';
  end if;

  update public.staff_login_invites
  set status = 'accepted', accepted_at = now()
  where id = v_invite.id
    and status = 'pending'
    and invited_auth_user_id = v_uid;

  if not found then
    raise exception 'invalid invite' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'membership_id', v_membership.id,
    'user_id', v_membership.user_id,
    'auth_user_id', v_uid,
    'organization_id', v_membership.organization_id,
    'invite_id', v_invite.id,
    'status', 'accepted'
  );
end;
$$;

comment on function public.bind_invited_staff_auth_user(text) is
  'Late-bind existing membership.auth_user_id from NULL to auth.uid() after a valid pending invite. Does not create Staff.';

create or replace function public.revoke_staff_login_invite(p_invite_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.staff_login_invites%rowtype;
  v_actor public.staff_auth_memberships%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_invite
  from public.staff_login_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'invalid invite' using errcode = '22023';
  end if;

  select * into v_actor
  from public.staff_auth_memberships
  where auth_user_id = v_uid
    and organization_id = v_invite.organization_id
    and is_active = true
    and role = 'OWNER'
  limit 1;

  if not found then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_invite.status is distinct from 'pending' then
    raise exception 'invalid invite' using errcode = '22023';
  end if;

  update public.staff_login_invites
  set status = 'revoked', revoked_at = now()
  where id = v_invite.id
    and status = 'pending';

  return jsonb_build_object('invite_id', v_invite.id, 'status', 'revoked');
end;
$$;

comment on function public.revoke_staff_login_invite(text) is
  'Owner-only revoke of a pending Staff login invite. Does not delete operational Staff.';

revoke all on function public.bind_invited_staff_auth_user(text) from public, anon;
grant execute on function public.bind_invited_staff_auth_user(text) to authenticated;
revoke all on function public.revoke_staff_login_invite(text) from public, anon;
grant execute on function public.revoke_staff_login_invite(text) to authenticated;

revoke update on public.staff_login_invites from authenticated, anon, public;
drop policy if exists staff_login_invites_accept_own on public.staff_login_invites;
drop policy if exists staff_login_invites_revoke_owner on public.staff_login_invites;
