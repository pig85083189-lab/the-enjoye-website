-- Phase 1C-5A.1 Appointment tenant-integrity hardening.
-- Scope: appointments only. No customer / service / location row changes.
-- No business INSERT. Appointments remain 0.
--
-- Does NOT change public.user_can_access_location globally.
-- Other tables may still use null location semantics.
--
-- Existing helpers reused (not duplicated):
--   user_has_org_membership(uuid)
--   user_can_access_location(uuid, uuid)
--   is_operational_staff_id(text)
--
-- No pre-existing customer/service/location belongs-to-organization helpers.
-- Same-org integrity is enforced by composite FKs (final authority for all roles).
-- Staff: narrowest safe check against staff_auth_memberships. Do not create
-- a second staff table. Login-less operational staff cannot be proven at DB.

-- ---------------------------------------------------------------------------
-- Supporting UNIQUE (id, organization_id) for composite FKs only.
-- id is already PK; this does not change customer / service / location rows.
-- ---------------------------------------------------------------------------
alter table public.customers
  drop constraint if exists customers_id_organization_id_key;
alter table public.customers
  add constraint customers_id_organization_id_key unique (id, organization_id);

alter table public.services
  drop constraint if exists services_id_organization_id_key;
alter table public.services
  add constraint services_id_organization_id_key unique (id, organization_id);

alter table public.locations
  drop constraint if exists locations_id_organization_id_key;
alter table public.locations
  add constraint locations_id_organization_id_key unique (id, organization_id);

-- Domain ScheduleAppointment requires locationId. Remote appointments = 0.
-- Scope the nullability change to appointments; do not alter other tables.
alter table public.appointments
  alter column location_id set not null;

comment on column public.appointments.location_id is
  'Required. Same-org as appointments.organization_id via appointments_location_same_org_fkey.';

-- Same-org FKs: appointment.organization_id must match the related row.
-- Applies to INSERT and UPDATE for every role, including service_role.
alter table public.appointments
  drop constraint if exists appointments_customer_same_org_fkey;
alter table public.appointments
  add constraint appointments_customer_same_org_fkey
    foreign key (customer_id, organization_id)
    references public.customers (id, organization_id)
    on delete restrict;

alter table public.appointments
  drop constraint if exists appointments_service_same_org_fkey;
alter table public.appointments
  add constraint appointments_service_same_org_fkey
    foreign key (service_id, organization_id)
    references public.services (id, organization_id)
    on delete restrict;

alter table public.appointments
  drop constraint if exists appointments_location_same_org_fkey;
alter table public.appointments
  add constraint appointments_location_same_org_fkey
    foreign key (location_id, organization_id)
    references public.locations (id, organization_id)
    on delete restrict;

-- ---------------------------------------------------------------------------
-- Staff: existing identity catalog only (staff_auth_memberships).
-- organization_id on memberships is the text app id, joined via organizations.app_id.
--
-- Remaining limitation (intentional):
--   A staff-* value with ZERO membership rows cannot be proven at DB.
--   Those remain adapter-validated (requireOperationalStaffId).
--   Auth UUID remains rejected by appointments_staff_id_operational /
--   is_operational_staff_id.
-- ---------------------------------------------------------------------------
create or replace function public.operational_staff_belongs_to_organization(
  target_staff text,
  target_org uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_staff is null
    or not exists (
      select 1
      from public.staff_auth_memberships m
      where m.user_id = target_staff
    )
    or exists (
      select 1
      from public.staff_auth_memberships m
      join public.organizations o on o.app_id = m.organization_id
      where m.user_id = target_staff
        and o.id = target_org
        and m.is_active = true
    );
$$;

comment on function public.operational_staff_belongs_to_organization(text, uuid) is
  'Appointment staff integrity. True when staff_id is null, has no membership rows (unprovable login-less staff), or has an active membership in target_org. False when memberships exist only in another org.';

create or replace function public.operational_staff_can_access_location(
  target_staff text,
  target_org uuid,
  target_loc uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.operational_staff_belongs_to_organization(target_staff, target_org)
    and (
      target_staff is null
      or target_loc is null
      or not exists (
        select 1
        from public.staff_auth_memberships m
        join public.organizations o on o.app_id = m.organization_id
        where m.user_id = target_staff
          and o.id = target_org
          and m.is_active = true
      )
      or not exists (
        select 1
        from public.staff_auth_membership_locations sml
        join public.staff_auth_memberships m on m.id = sml.membership_id
        join public.organizations o on o.app_id = m.organization_id
        where m.user_id = target_staff
          and o.id = target_org
          and m.is_active = true
      )
      or exists (
        select 1
        from public.staff_auth_membership_locations sml
        join public.staff_auth_memberships m on m.id = sml.membership_id
        join public.organizations o on o.app_id = m.organization_id
        join public.locations l
          on l.id = target_loc
         and l.organization_id = target_org
         and l.app_id = sml.location_id
        where m.user_id = target_staff
          and o.id = target_org
          and m.is_active = true
      )
    );
$$;

comment on function public.operational_staff_can_access_location(text, uuid, uuid) is
  'Assigned operational staff location check. Distinct from user_can_access_location (auth.uid()). Login-less staff (no membership) cannot be proven and pass this helper.';

create or replace function public.enforce_appointment_staff_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.staff_id is not null
     and not public.operational_staff_belongs_to_organization(
       new.staff_id,
       new.organization_id
     ) then
    raise exception 'appointment staff_id is not an operational staff member of this organization'
      using errcode = '23514';
  end if;
  if new.staff_id is not null
     and not public.operational_staff_can_access_location(
       new.staff_id,
       new.organization_id,
       new.location_id
     ) then
    raise exception 'appointment staff_id cannot operate at this location'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_staff_integrity on public.appointments;
create trigger trg_appointments_staff_integrity
before insert or update on public.appointments
for each row execute function public.enforce_appointment_staff_integrity();

revoke all on function public.operational_staff_belongs_to_organization(text, uuid) from public;
revoke all on function public.operational_staff_can_access_location(text, uuid, uuid) from public;
revoke all on function public.enforce_appointment_staff_integrity() from public;
grant execute on function public.operational_staff_belongs_to_organization(text, uuid) to authenticated;
grant execute on function public.operational_staff_can_access_location(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Appointment-scoped RLS. Tenant integrity stays on FKs/trigger.
-- Authorization stays on membership + user_can_access_location.
-- location_id IS NOT NULL is Appointment-scoped; the global helper is unchanged.
-- UPDATE USING also requires location access so a restricted user cannot
-- retarget an appointment they cannot access.
-- ---------------------------------------------------------------------------
drop policy if exists appointments_insert_org on public.appointments;
drop policy if exists appointments_update_org on public.appointments;

create policy appointments_insert_org on public.appointments
  for insert to authenticated
  with check (
    appointments.location_id is not null
    and public.user_has_org_membership(appointments.organization_id)
    and public.user_can_access_location(
      appointments.organization_id,
      appointments.location_id
    )
  );

create policy appointments_update_org on public.appointments
  for update to authenticated
  using (
    public.user_has_org_membership(appointments.organization_id)
    and public.user_can_access_location(
      appointments.organization_id,
      appointments.location_id
    )
  )
  with check (
    appointments.location_id is not null
    and public.user_has_org_membership(appointments.organization_id)
    and public.user_can_access_location(
      appointments.organization_id,
      appointments.location_id
    )
  );
