-- Phase 2 foundation. Review and apply to staging first; never auto-run on production.
-- Staff membership ids and organization ids are legacy TEXT identifiers.
create table if not exists public.staff_leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  location_id text not null,
  staff_membership_id text not null references public.staff_auth_memberships(id),
  leave_type text not null check (leave_type in ('scheduled_off','annual','personal','sick')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by_membership_id text references public.staff_auth_memberships(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_leave_valid_interval check (starts_at < ends_at),
  constraint staff_leave_review_consistency check (
    (status in ('pending','cancelled') and reviewed_by_membership_id is null and reviewed_at is null)
    or (status in ('approved','rejected') and reviewed_by_membership_id is not null and reviewed_at is not null)
  )
);
create index if not exists staff_leave_requests_tenant_date_idx
  on public.staff_leave_requests(organization_id,location_id,starts_at,ends_at);
create index if not exists staff_leave_requests_staff_status_idx
  on public.staff_leave_requests(staff_membership_id,status,starts_at);
alter table public.staff_leave_requests enable row level security;
-- No client policies: reads/writes must go through authenticated, tenant-checked server endpoints.
revoke all on public.staff_leave_requests from anon, authenticated;
comment on table public.staff_leave_requests is
  'Leave workflow; approved rows must not automatically cancel existing appointments. Approval API must verify conflicts and tenant scope.';
