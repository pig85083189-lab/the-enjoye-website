-- Additive production foundation: does not modify existing browser schedules or bookings.
create table if not exists public.booking_staff_working_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  location_id text not null,
  staff_id text not null,
  day_of_week integer not null check(day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_working boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint booking_staff_working_hours_valid_range check(start_time < end_time),
  constraint booking_staff_working_hours_unique unique(organization_id,location_id,staff_id,day_of_week)
);
create index if not exists booking_staff_working_hours_location_idx
on public.booking_staff_working_hours(organization_id,location_id,staff_id);
alter table public.booking_staff_working_hours enable row level security;
revoke all on public.booking_staff_working_hours from anon,authenticated;
comment on table public.booking_staff_working_hours is
'Authoritative weekly staff schedule foundation; import localStorage only with explicit authenticated staff action. No booking availability switch until validated.';
