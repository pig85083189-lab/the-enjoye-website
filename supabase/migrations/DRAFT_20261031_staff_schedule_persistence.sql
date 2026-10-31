-- Design-only migration. NOT APPLIED. Review before running against live Beauty OS.
-- Persist the staff schedule that is currently stored in browser localStorage.
create table if not exists public.staff_working_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.locations(id),
  staff_id text not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_working boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (organization_id, location_id, staff_id, day_of_week),
  check (not is_working or end_time > start_time)
);
create table if not exists public.staff_schedule_breaks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.locations(id),
  staff_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  label text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table if not exists public.staff_schedule_time_off (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.locations(id),
  staff_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  status text not null default 'APPROVED' check (status in ('APPROVED','REQUESTED','REJECTED')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists staff_schedule_breaks_window_idx
  on public.staff_schedule_breaks (organization_id, location_id, staff_id, starts_at, ends_at);
create index if not exists staff_schedule_time_off_window_idx
  on public.staff_schedule_time_off (organization_id, location_id, staff_id, starts_at, ends_at);
alter table public.staff_working_hours enable row level security;
alter table public.staff_schedule_breaks enable row level security;
alter table public.staff_schedule_time_off enable row level security;
revoke all on public.staff_working_hours, public.staff_schedule_breaks, public.staff_schedule_time_off from anon, authenticated;

-- Reject cross-tenant locations. Staff membership validation still needs
-- authoritative mapping between legacy text staffId and staff_auth_memberships.
create or replace function public.guard_staff_schedule_location()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id and l.is_active
  ) then
    raise exception 'Schedule location tenant mismatch or inactive location';
  end if;
  return new;
end;
$$;
create trigger staff_working_hours_location_guard before insert or update on public.staff_working_hours
  for each row execute function public.guard_staff_schedule_location();
create trigger staff_schedule_breaks_location_guard before insert or update on public.staff_schedule_breaks
  for each row execute function public.guard_staff_schedule_location();
create trigger staff_schedule_time_off_location_guard before insert or update on public.staff_schedule_time_off
  for each row execute function public.guard_staff_schedule_location();

-- Intentionally no RLS policies or public booking endpoint yet.
-- Migration of browser localStorage schedule requires staff-ID mapping,
-- explicit admin review and a safe import procedure; never default unknown
-- working hours to available.
