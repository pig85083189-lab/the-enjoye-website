-- Phase 1C-6G Treatment remote persistence foundation.
-- Reuses public.treatments. Does NOT create a parallel treatment table.
-- Scope: treatments only. No Customer / Appointment / Staff business INSERTs.
-- Agent must not apply this to Production.
--
-- Existing helpers reused (not duplicated):
--   user_has_org_membership(uuid)
--   user_can_access_location(uuid, uuid)
--   is_operational_staff_id(text)
--   operational_staff_belongs_to_organization(text, uuid)
--   operational_staff_can_access_location(text, uuid, uuid)
--
-- Photos: photo_meta is metadata-only (hadPreview). No Storage bucket.
-- Do not write image bytes / base64 / object URLs into treatments.

-- ---------------------------------------------------------------------------
-- Clinical / attribution columns missing from the operational ADAPT.
-- ---------------------------------------------------------------------------
alter table public.treatments
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists suggested_tracking_areas jsonb not null default '[]'::jsonb,
  add column if not exists selected_quick_phrases jsonb not null default '[]'::jsonb,
  add column if not exists note_manually_edited boolean not null default false,
  add column if not exists quick_record_applied_at timestamptz,
  add column if not exists photo_meta jsonb not null default '[]'::jsonb;

comment on column public.treatments.photo_meta is
  'Metadata only (id, type, createdAt, hadPreview). Not image bytes. Not Storage.';

comment on column public.treatments.created_by is
  'Operational staff-* id. Never an Auth UUID.';

comment on column public.treatments.updated_by is
  'Operational staff-* id. Never an Auth UUID.';

alter table public.treatments drop constraint if exists treatments_created_by_operational;
alter table public.treatments
  add constraint treatments_created_by_operational
  check (created_by is null or public.is_operational_staff_id(created_by));

alter table public.treatments drop constraint if exists treatments_updated_by_operational;
alter table public.treatments
  add constraint treatments_updated_by_operational
  check (updated_by is null or public.is_operational_staff_id(updated_by));

-- Remote treatments = 0. Location is required for authenticated remote writes.
alter table public.treatments
  alter column location_id set not null;

comment on column public.treatments.location_id is
  'Required. Same-org as treatments.organization_id via treatments_location_same_org_fkey.';

-- One remote treatment per appointment when an appointment is supplied.
create unique index if not exists idx_treatments_org_appointment
  on public.treatments (organization_id, appointment_id)
  where appointment_id is not null;

-- Supporting UNIQUE (id, organization_id) for treatment → appointment same-org FK.
alter table public.appointments
  drop constraint if exists appointments_id_organization_id_key;
alter table public.appointments
  add constraint appointments_id_organization_id_key unique (id, organization_id);

-- Same-org FKs. Final tenant-integrity authority for every role, including service_role.
alter table public.treatments
  drop constraint if exists treatments_customer_same_org_fkey;
alter table public.treatments
  add constraint treatments_customer_same_org_fkey
    foreign key (customer_id, organization_id)
    references public.customers (id, organization_id)
    on delete restrict;

alter table public.treatments
  drop constraint if exists treatments_service_same_org_fkey;
alter table public.treatments
  add constraint treatments_service_same_org_fkey
    foreign key (service_id, organization_id)
    references public.services (id, organization_id)
    on delete restrict;

alter table public.treatments
  drop constraint if exists treatments_location_same_org_fkey;
alter table public.treatments
  add constraint treatments_location_same_org_fkey
    foreign key (location_id, organization_id)
    references public.locations (id, organization_id)
    on delete restrict;

alter table public.treatments
  drop constraint if exists treatments_appointment_same_org_fkey;
alter table public.treatments
  add constraint treatments_appointment_same_org_fkey
    foreign key (appointment_id, organization_id)
    references public.appointments (id, organization_id)
    on delete restrict;

-- ---------------------------------------------------------------------------
-- Staff + appointment tenant integrity. Reuses Appointment helpers.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_treatment_staff_integrity()
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
    raise exception 'treatment staff_id is not an operational staff member of this organization'
      using errcode = '23514';
  end if;
  if new.staff_id is not null
     and not public.operational_staff_can_access_location(
       new.staff_id,
       new.organization_id,
       new.location_id
     ) then
    raise exception 'treatment staff_id cannot operate at this location'
      using errcode = '23514';
  end if;
  if new.created_by is not null
     and not public.operational_staff_belongs_to_organization(
       new.created_by,
       new.organization_id
     ) then
    raise exception 'treatment created_by is not an operational staff member of this organization'
      using errcode = '23514';
  end if;
  if new.updated_by is not null
     and not public.operational_staff_belongs_to_organization(
       new.updated_by,
       new.organization_id
     ) then
    raise exception 'treatment updated_by is not an operational staff member of this organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_treatments_staff_integrity on public.treatments;
create trigger trg_treatments_staff_integrity
before insert or update on public.treatments
for each row execute function public.enforce_treatment_staff_integrity();

create or replace function public.enforce_treatment_appointment_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.appointment_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.appointments a
    where a.id = new.appointment_id
      and a.organization_id = new.organization_id
      and a.customer_id = new.customer_id
      and a.location_id = new.location_id
  ) then
    raise exception 'treatment appointment must belong to the same organization, location, and customer'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_treatments_appointment_integrity on public.treatments;
create trigger trg_treatments_appointment_integrity
before insert or update on public.treatments
for each row execute function public.enforce_treatment_appointment_integrity();

-- Completed records are not VOID-reopened in this slice.
create or replace function public.enforce_treatment_completed_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'COMPLETED'::public.treatment_status
     and new.status = 'DRAFT'::public.treatment_status then
    raise exception 'completed treatment cannot return to DRAFT'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_treatments_completed_immutable on public.treatments;
create trigger trg_treatments_completed_immutable
before update on public.treatments
for each row execute function public.enforce_treatment_completed_immutable();

revoke all on function public.enforce_treatment_staff_integrity() from public;
revoke all on function public.enforce_treatment_appointment_integrity() from public;
revoke all on function public.enforce_treatment_completed_immutable() from public;

-- ---------------------------------------------------------------------------
-- Location-aware RLS. Tenant integrity stays on FKs/triggers.
-- Authorization stays on membership + user_can_access_location.
-- ---------------------------------------------------------------------------
drop policy if exists treatments_select_org on public.treatments;
drop policy if exists treatments_insert_org on public.treatments;
drop policy if exists treatments_update_org on public.treatments;
drop policy if exists treatments_delete_org on public.treatments;

create policy treatments_select_org on public.treatments
  for select to authenticated
  using (
    public.user_has_org_membership(treatments.organization_id)
    and public.user_can_access_location(
      treatments.organization_id,
      treatments.location_id
    )
  );

create policy treatments_insert_org on public.treatments
  for insert to authenticated
  with check (
    treatments.location_id is not null
    and public.user_has_org_membership(treatments.organization_id)
    and public.user_can_access_location(
      treatments.organization_id,
      treatments.location_id
    )
  );

create policy treatments_update_org on public.treatments
  for update to authenticated
  using (
    public.user_has_org_membership(treatments.organization_id)
    and public.user_can_access_location(
      treatments.organization_id,
      treatments.location_id
    )
  )
  with check (
    treatments.location_id is not null
    and public.user_has_org_membership(treatments.organization_id)
    and public.user_can_access_location(
      treatments.organization_id,
      treatments.location_id
    )
  );

create policy treatments_delete_org on public.treatments
  for delete to authenticated
  using (
    public.user_has_org_membership(treatments.organization_id)
    and public.staff_role_is_managerial(public.user_org_role(treatments.organization_id))
  );
