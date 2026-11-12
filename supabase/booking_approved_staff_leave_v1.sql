-- Preview-only read model for future booking availability integration.
-- This view maps approved leave to the same staff_id used by booking schedules.
-- It does NOT authorize leave approval or change booking availability by itself.
create or replace view public.booking_approved_staff_leave_v1
with (security_invoker = true)
as
select
  r.id as leave_request_id,
  r.organization_id,
  r.location_id,
  m.user_id as staff_id,
  r.starts_at,
  r.ends_at,
  r.reviewed_at
from public.staff_leave_requests r
join public.staff_auth_memberships m
  on m.id = r.staff_membership_id
 and m.organization_id = r.organization_id
where r.status = 'approved'
  and m.is_active = true
  and m.user_id is not null;
revoke all on public.booking_approved_staff_leave_v1 from anon, authenticated;
comment on view public.booking_approved_staff_leave_v1 is
  'Preview-only approved leave projection. Booking availability must query this alongside schedules, time off and appointments; no approval is enabled.';
