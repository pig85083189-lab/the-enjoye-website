-- Local-only stubs for Phase 2B appointment reminder persistence tests.
-- Never connect to Preview or Production. Never call LINE.

create schema if not exists auth;
create schema if not exists tests;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres;
  end if;
end $$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_uid', true), '')::uuid;
$$;

create or replace function public.is_auth_uuid(value text)
returns boolean
language sql
immutable
as $$
  select value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

create or replace function public.is_operational_staff_id(value text)
returns boolean
language sql
immutable
as $$
  select value is not null
    and length(btrim(value)) > 0
    and not public.is_auth_uuid(value);
$$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  app_id text not null unique,
  name text not null default 'org'
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

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  app_id text not null,
  full_name text not null default '客人',
  line_user_id text,
  unique (organization_id, app_id)
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  app_id text not null,
  name text not null default '課程',
  unique (organization_id, app_id)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  app_id text not null,
  customer_id uuid not null references public.customers (id),
  service_id uuid not null references public.services (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'BOOKED',
  unique (organization_id, app_id)
);

create table if not exists public.line_official_accounts (
  organization_id text primary key,
  channel_id text,
  bot_display_name text,
  bot_basic_id text,
  broadcast_enabled boolean not null default false,
  broadcast_test_runtime_open boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.line_broadcasts (
  id text primary key,
  organization_id text not null,
  status text not null default 'draft',
  text_body text not null default '',
  request_id text not null,
  created_by_staff_id text not null default 'staff-local',
  created_at timestamptz not null default now(),
  send_claimed_at timestamptz
);

create or replace function tests.assert(cond boolean, msg text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'ASSERT FAILED: %', msg;
  end if;
end;
$$;

grant usage on schema public to service_role, authenticated, anon;
grant usage on schema tests to service_role, authenticated, anon;

create or replace function tests.become(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('app.current_uid', coalesce(p_uid::text, ''), false);
end;
$$;

insert into public.organizations (id, app_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'org-the-enjoye', 'THE ENJOYE'),
  ('22222222-2222-2222-2222-222222222222', 'org-lumiere', 'LUMIERE')
on conflict (app_id) do nothing;

insert into public.staff_auth_memberships (
  id, user_id, auth_user_id, organization_id, role, display_name, is_active
) values
  ('mem-enjoye-owner', 'staff-enjoye', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org-the-enjoye', 'OWNER', '店長A', true),
  ('mem-lumiere-owner', 'staff-lumiere', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'org-lumiere', 'OWNER', '店長B', true),
  ('mem-enjoye-staff', 'staff-enjoye-2', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'org-the-enjoye', 'STAFF', '員工', true)
on conflict (id) do nothing;

insert into public.line_official_accounts (organization_id, channel_id) values
  ('org-the-enjoye', '2009219238'),
  ('org-lumiere', '2009219238')
on conflict (organization_id) do nothing;

insert into public.customers (id, organization_id, app_id, full_name, line_user_id) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'cust-1', '林小姐', 'U0123456789abcdef0123456789abcdef')
on conflict do nothing;

insert into public.services (id, organization_id, app_id, name) values
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'svc-1', '美胸 SPA')
on conflict do nothing;

insert into public.appointments (
  organization_id, app_id, customer_id, service_id, starts_at, ends_at, status
) values (
  '11111111-1111-1111-1111-111111111111',
  'apt-future',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  timezone('Asia/Taipei', timestamp '2026-10-14 16:00:00'),
  timezone('Asia/Taipei', timestamp '2026-10-14 17:00:00'),
  'BOOKED'
)
on conflict do nothing;
