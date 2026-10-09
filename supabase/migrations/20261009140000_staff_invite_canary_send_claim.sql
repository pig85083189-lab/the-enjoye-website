-- =============================================================================
-- Beauty OS — Preview canary one-time invite send claim
-- Additive only. Does not send email. Does not mutate invites, memberships,
-- Auth users, or operational Staff. Process-local locks are not sufficient.
--
-- Durable lock: PRIMARY KEY insert of a single allowed claim id.
-- Parallel callers: one INSERT commits; the rest hit unique_violation.
-- Actor is always auth.uid() → active OWNER membership. No client Owner id.
-- =============================================================================

create table if not exists public.staff_invite_canary_send_claims (
  id text primary key,
  invite_id text not null,
  membership_id text not null,
  organization_id text not null,
  email text not null,
  claimed_at timestamptz not null default now(),
  claimed_by_staff_id text not null,
  constraint staff_invite_canary_send_claims_id_check
    check (id = 'canary-resend:inv-30506ef33d4d4f68'),
  constraint staff_invite_canary_send_claims_invite_check
    check (invite_id = 'inv-30506ef33d4d4f68'),
  constraint staff_invite_canary_send_claims_membership_check
    check (membership_id = 'mem-preview-canary-dog1060330'),
  constraint staff_invite_canary_send_claims_org_check
    check (organization_id = 'org-the-enjoye'),
  constraint staff_invite_canary_send_claims_email_check
    check (email = 'dog1060330@gmail.com'),
  constraint staff_invite_canary_send_claims_inviter_operational
    check (public.is_operational_staff_id(claimed_by_staff_id))
);

comment on table public.staff_invite_canary_send_claims is
  'Single-row durable lock for one Preview canary invite resend. Insert once; primary key prevents a second send. Does not send email.';

alter table public.staff_invite_canary_send_claims enable row level security;

revoke all on table public.staff_invite_canary_send_claims
  from public, anon, authenticated, service_role;

grant select on table public.staff_invite_canary_send_claims to authenticated;

drop policy if exists staff_invite_canary_send_claims_select_owner
  on public.staff_invite_canary_send_claims;
create policy staff_invite_canary_send_claims_select_owner
on public.staff_invite_canary_send_claims
for select
to authenticated
using (
  exists (
    select 1
    from public.staff_auth_memberships as m
    where m.auth_user_id = (select auth.uid())
      and m.organization_id = 'org-the-enjoye'
      and m.organization_id = public.staff_invite_canary_send_claims.organization_id
      and m.is_active = true
      and m.role = 'OWNER'
  )
);

create or replace function public.claim_staff_invite_canary_send()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_claim_id constant text := 'canary-resend:inv-30506ef33d4d4f68';
  v_invite_id constant text := 'inv-30506ef33d4d4f68';
  v_membership_id constant text := 'mem-preview-canary-dog1060330';
  v_organization_id constant text := 'org-the-enjoye';
  v_email constant text := 'dog1060330@gmail.com';
  v_actor public.staff_auth_memberships%rowtype;
  v_membership public.staff_auth_memberships%rowtype;
  v_invite public.staff_login_invites%rowtype;
  v_claimed_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_actor
  from public.staff_auth_memberships
  where auth_user_id = v_uid
    and organization_id = v_organization_id
    and is_active = true
    and role = 'OWNER'
  limit 1
  for update;

  if not found then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not public.is_operational_staff_id(v_actor.user_id) then
    raise exception 'invalid actor' using errcode = '42501';
  end if;

  select * into v_membership
  from public.staff_auth_memberships
  where id = v_membership_id
  for update;

  if not found then
    raise exception 'invalid membership' using errcode = '22023';
  end if;
  if v_membership.organization_id is distinct from v_organization_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_membership.user_id is distinct from 'staff-preview-canary-dog1060330' then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_membership.role is distinct from 'STAFF' then
    raise exception 'unauthorized' using errcode = '42501';
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

  select * into v_invite
  from public.staff_login_invites
  where id = v_invite_id
  for update;

  if not found then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  if v_invite.membership_id is distinct from v_membership_id
     or v_invite.organization_id is distinct from v_organization_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_invite.status is distinct from 'pending' or v_invite.expires_at <= now() then
    raise exception 'invite expired' using errcode = '22023';
  end if;
  if v_invite.accepted_at is not null or v_invite.revoked_at is not null then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  if lower(btrim(v_invite.email)) is distinct from v_email then
    raise exception 'email mismatch' using errcode = '42501';
  end if;
  if v_invite.invited_auth_user_id is null then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from auth.users as u
    where u.id = v_invite.invited_auth_user_id
      and lower(u.email) = v_email
      and u.deleted_at is null
  ) then
    raise exception 'invalid invite' using errcode = '22023';
  end if;

  begin
    insert into public.staff_invite_canary_send_claims (
      id,
      invite_id,
      membership_id,
      organization_id,
      email,
      claimed_by_staff_id
    ) values (
      v_claim_id,
      v_invite_id,
      v_membership_id,
      v_organization_id,
      v_email,
      v_actor.user_id
    )
    returning claimed_at into v_claimed_at;
  exception
    when unique_violation then
      return jsonb_build_object(
        'ok', false,
        'reason', 'already_claimed',
        'message', '此次 Preview 測試僅允許寄送一封邀請，且不得重寄'
      );
  end;

  return jsonb_build_object(
    'ok', true,
    'claim_id', v_claim_id,
    'invite_id', v_invite_id,
    'membership_id', v_membership_id,
    'organization_id', v_organization_id,
    'claimed_at', v_claimed_at
  );
end;
$$;

comment on function public.claim_staff_invite_canary_send() is
  'Owner-only durable one-time claim for the Preview canary invite resend. Actor is auth.uid(). Does not send email, mutate staff_login_invites, bind membership, create Staff, or delete Auth users.';

revoke all on function public.claim_staff_invite_canary_send()
  from public, anon;
grant execute on function public.claim_staff_invite_canary_send()
  to authenticated;
