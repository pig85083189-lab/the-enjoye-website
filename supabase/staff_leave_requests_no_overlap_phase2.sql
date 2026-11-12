-- Prevent concurrent duplicate pending/approved leave requests for the same staff.
-- Applied in Preview first. Requires btree_gist for text equality with range exclusion.
create extension if not exists btree_gist;
alter table public.staff_leave_requests
  add constraint staff_leave_no_active_overlap
  exclude using gist (
    organization_id with =,
    location_id with =,
    staff_membership_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status in ('pending', 'approved'));
