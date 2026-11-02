-- Staged only. Apply after booking_staff_time_off_v1.sql, NOT yet applied.
-- Prevent concurrent requests from inserting overlapping pending/approved leave.
-- Application-level SELECT checks alone cannot prevent two simultaneous POSTs.
create extension if not exists btree_gist with schema extensions;

alter table public.booking_staff_time_off
  add constraint booking_staff_time_off_no_active_overlap
  exclude using gist (
    organization_id with =,
    location_id with =,
    staff_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('REQUESTED', 'APPROVED'));

-- Half-open [start,end) intervals permit adjacent non-overlapping leaves.
-- REJECTED rows are excluded, so the same dates may be requested again.
-- Existing overlapping rows must be reconciled before this constraint can be added.
