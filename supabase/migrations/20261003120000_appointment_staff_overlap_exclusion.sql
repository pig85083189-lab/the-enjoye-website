-- Phase 1C-6B.1 Appointment staff overlap exclusion.
-- Draft only. DO NOT apply to remote Supabase / Preview / Production in 1C-6B.1.
--
-- Purpose: DB-authoritative rejection of overlapping active appointments
-- assigned to the same operational staff inside an organization.
--
-- Semantics (match current domain hasAppointmentConflict):
--   - same organization_id
--   - same staff_id (operational text, not Auth UUID)
--   - tstzrange(starts_at, ends_at, '[)') overlap
--   - CANCELLED / NO_SHOW do not participate
--   - adjacent existing.end == new.start is allowed
--   - location_id is NOT part of the key (same staff cannot double-book
--     across locations; current domain is staff-scoped, not location-scoped)
--
-- Requires btree_gist so uuid/text equality can live on a GiST exclude.
-- Existing QA row (apt-muqrindw-yt0l5z, single BOOKED interval) is compatible.
-- Rollback: drop constraint appointments_staff_active_no_overlap.
--
-- No business INSERT / UPDATE / DELETE in this file.

create extension if not exists btree_gist;

alter table public.appointments
  drop constraint if exists appointments_staff_active_no_overlap;

alter table public.appointments
  add constraint appointments_staff_active_no_overlap
  exclude using gist (
    organization_id with =,
    staff_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (
    staff_id is not null
    and status not in ('CANCELLED', 'NO_SHOW')
  );

comment on constraint appointments_staff_active_no_overlap on public.appointments is
  'Same-org operational staff cannot have overlapping active appointments. Adjacent end=start allowed. CANCELLED/NO_SHOW excluded. Drafted in 1C-6B.1; not applied remotely in that phase.';
