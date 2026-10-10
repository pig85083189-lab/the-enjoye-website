-- =============================================================================
-- Beauty OS — Staff CREATE V1 (operational staff only)
-- Migration: 20261007140000_staff_operational_create.sql
--
-- Additive. Does not rewrite 112950 / 113000 / 06120000.
-- Creates Operational Staff rows on staff_auth_memberships + location
-- assignments. Does NOT create auth.users, invites, passwords, or login.
--
-- auth_user_id must stay null on this path.
-- created_by_staff_id is derived from the authenticated session.
-- Only OWNER / MANAGER may INSERT. STAFF / RECEPTIONIST / ACCOUNTANT denied.
-- No UPDATE / DELETE grant.
-- =============================================================================

alter table public.staff_auth_memberships
  add column if not exists phone text,
  add column if not exists title text,
  add column if not exists created_by_staff_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_auth_memberships_created_by_operational'
      and conrelid = 'public.staff_auth_memberships'::regclass
  ) then
    alter table public.staff_auth_memberships
      add constraint staff_auth_memberships_created_by_operational
      check (
        created_by_staff_id is null
        or public.is_operational_staff_id(created_by_staff_id)
      );
  end if;
end
$$;

comment on column public.staff_auth_memberships.phone is
  'Optional operational contact. Not a login identifier.';
comment on column public.staff_auth_memberships.title is
  'Optional job title. Canonical role stays on role.';
comment on column public.staff_auth_memberships.created_by_staff_id is
  'Operational staff-* of the authenticated creator. Never a client-supplied Auth UUID.';

drop policy if exists staff_auth_memberships_insert_operational
  on public.staff_auth_memberships;
create policy staff_auth_memberships_insert_operational
on public.staff_auth_memberships
for insert
to authenticated
with check (
  staff_auth_memberships.auth_user_id is null
  and public.is_operational_staff_id(staff_auth_memberships.user_id)
  and staff_auth_memberships.role in ('MANAGER', 'STAFF', 'RECEPTIONIST', 'ACCOUNTANT')
  and staff_auth_memberships.is_active = true
  and exists (
    select 1
    from public.organizations o
    where o.app_id = staff_auth_memberships.organization_id
      and public.user_has_org_membership(o.id)
      and public.staff_role_is_managerial(public.user_org_role(o.id))
      and public.is_operational_staff_id(staff_auth_memberships.created_by_staff_id)
      and staff_auth_memberships.created_by_staff_id
        = public.user_operational_staff_id(o.id)
  )
);

drop policy if exists staff_auth_membership_locations_insert_operational
  on public.staff_auth_membership_locations;
create policy staff_auth_membership_locations_insert_operational
on public.staff_auth_membership_locations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.staff_auth_memberships m
    join public.organizations o on o.app_id = m.organization_id
    join public.locations l
      on l.app_id = staff_auth_membership_locations.location_id
     and l.organization_id = o.id
    where m.id = staff_auth_membership_locations.membership_id
      and m.auth_user_id is null
      and public.user_has_org_membership(o.id)
      and public.staff_role_is_managerial(public.user_org_role(o.id))
      and public.user_can_access_location(o.id, l.id)
  )
);

revoke all on public.staff_auth_memberships from anon, public;
revoke all on public.staff_auth_membership_locations from anon, public;
grant select, insert on public.staff_auth_memberships to authenticated;
grant select, insert on public.staff_auth_membership_locations to authenticated;

comment on policy staff_auth_memberships_insert_operational on public.staff_auth_memberships is
  'Staff CREATE V1: OWNER/MANAGER insert operational staff only. auth_user_id must be null.';
comment on policy staff_auth_membership_locations_insert_operational
  on public.staff_auth_membership_locations is
  'Staff CREATE V1: assign canonical locations the actor can access. No fake locations.';
