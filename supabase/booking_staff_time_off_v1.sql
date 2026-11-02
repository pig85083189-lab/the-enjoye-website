-- Beauty OS leave requests: staged schema, NOT applied to production.
-- All access through authenticated server routes with tenant and role checks.
create table if not exists public.booking_staff_time_off (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  location_id text not null,
  staff_id text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','APPROVED','REJECTED')),
  source text not null default 'STAFF_REQUEST' check (source in ('STAFF_REQUEST','MANAGER_DIRECT')),
  requested_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_staff_time_off_valid_range check (start_at < end_at),
  constraint booking_staff_time_off_review_consistency check (
    (status = 'REQUESTED' and reviewed_at is null and reviewed_by is null)
    or (status in ('APPROVED','REJECTED') and reviewed_at is not null and reviewed_by is not null)
  )
);
create index if not exists booking_staff_time_off_scope_idx
  on public.booking_staff_time_off (organization_id,location_id,staff_id,start_at,end_at);
create index if not exists booking_staff_time_off_pending_idx
  on public.booking_staff_time_off (organization_id,location_id,status,created_at);
alter table public.booking_staff_time_off enable row level security;
revoke all on public.booking_staff_time_off from anon, authenticated;
comment on table public.booking_staff_time_off is
  'Staff requests and manager-directed leave; approval must check appointments server-side before committing. No client direct access.';
