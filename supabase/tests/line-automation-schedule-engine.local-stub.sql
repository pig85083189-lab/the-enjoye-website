-- Local-only Phase 2B jobs stub for the Phase 2A schedule upgrade.
-- Never connect to Preview or Production. Never call LINE.

create schema if not exists auth;
create schema if not exists tests;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_uid', true), '')::uuid;
$$;

create or replace function tests.become(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('app.current_uid', p_uid::text, false);
end;
$$;

create table if not exists public.organizations (
  id uuid primary key,
  name text not null,
  app_id text not null unique
);

create table if not exists public.staff_auth_memberships (
  id text primary key,
  user_id text not null,
  auth_user_id uuid,
  organization_id text not null,
  role text not null,
  display_name text not null,
  is_active boolean not null default true
);

create or replace function public.user_is_org_owner(target_org_app_id text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.staff_auth_memberships m
    where m.organization_id = target_org_app_id
      and m.auth_user_id = auth.uid()
      and m.is_active = true
      and m.role = 'OWNER'
  );
$$;

create table if not exists public.line_automation_jobs (
  id text primary key,
  organization_id text not null,
  appointment_app_id text not null,
  customer_app_id text not null,
  service_app_id text,
  timing_id text not null,
  fingerprint text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled',
  request_id text not null,
  claimed_at timestamptz,
  send_claimed_at timestamptz,
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_automation_jobs_timing_check
    check (timing_id in ('day_before_morning', 'hours_before_3')),
  constraint line_automation_jobs_status_check
    check (
      status in (
        'scheduled', 'claimed', 'accepted', 'failed', 'canceled',
        'expired', 'skipped', 'pending_confirmation', 'reconciled'
      )
    ),
  constraint line_automation_jobs_id_org_key unique (id, organization_id)
);

insert into public.organizations (id, name, app_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'THE ENJOYE', 'org-the-enjoye'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'LUMIERE', 'org-lumiere');

insert into public.staff_auth_memberships (
  id, user_id, auth_user_id, organization_id, role, display_name, is_active
) values
  (
    'mem-enjoye-owner', 'staff-enjoye-owner',
    '11111111-1111-1111-1111-111111111111',
    'org-the-enjoye', 'OWNER', '享悅店長', true
  ),
  (
    'mem-lumiere-owner', 'staff-lumiere-owner',
    '22222222-2222-2222-2222-222222222222',
    'org-lumiere', 'OWNER', 'LUMIERE 店長', true
  );

insert into public.line_automation_jobs (
  id, organization_id, appointment_app_id, customer_app_id, service_app_id,
  timing_id, fingerprint, scheduled_for, status, request_id
) values
  (
    'laj-keep-day', 'org-the-enjoye', 'appt-keep', 'cust-1', 'svc-1',
    'day_before_morning', 'org-the-enjoye|appointment_reminder|appt-keep|day_before_morning',
    now() + interval '1 day', 'scheduled', 'larq-keep-day'
  ),
  (
    'laj-accepted', 'org-the-enjoye', 'appt-keep', 'cust-1', 'svc-1',
    'hours_before_3', 'org-the-enjoye|appointment_reminder|appt-keep|hours_before_3',
    now() + interval '3 hours', 'accepted', 'larq-accepted'
  );
