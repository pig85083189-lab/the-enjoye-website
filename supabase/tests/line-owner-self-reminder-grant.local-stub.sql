-- Local-only stubs for Phase 2E-9 Owner-self grant privilege tests.
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
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_auth_members m
    join pg_roles r on r.oid = m.roleid
    join pg_roles u on u.oid = m.member
    where r.rolname = 'service_role' and u.rolname = 'authenticator'
  ) then
    execute 'grant service_role to authenticator';
  end if;
  if not exists (
    select 1 from pg_auth_members m
    join pg_roles r on r.oid = m.roleid
    join pg_roles u on u.oid = m.member
    where r.rolname = 'authenticated' and u.rolname = 'authenticator'
  ) then
    execute 'grant authenticated to authenticator';
  end if;
  if not exists (
    select 1 from pg_auth_members m
    join pg_roles r on r.oid = m.roleid
    join pg_roles u on u.oid = m.member
    where r.rolname = 'anon' and u.rolname = 'authenticator'
  ) then
    execute 'grant anon to authenticator';
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

create table if not exists public.line_official_accounts (
  organization_id text primary key,
  channel_id text
);

create table if not exists public.line_owner_recipients (
  organization_id text primary key,
  staff_user_id text not null,
  line_user_id_hint text not null,
  bind_method text not null,
  bound_at timestamptz not null
);

create table if not exists public.line_owner_recipient_secrets (
  organization_id text primary key,
  key_id text not null
);

create table if not exists public.line_broadcasts (
  id text primary key,
  organization_id text not null,
  status text not null default 'draft'
);

create or replace function public.line_broadcast_channel_has_inflight(p_channel_id text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.line_broadcasts s
    join public.line_official_accounts a on a.organization_id = s.organization_id
    where p_channel_id is not null
      and a.channel_id = p_channel_id
      and s.status in ('sending', 'pending_confirmation')
  );
$$;

create or replace function tests.become(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('app.current_uid', p_uid::text, true);
end;
$$;

create or replace function tests.assert(p_ok boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_ok is not true then
    raise exception '%', p_message;
  end if;
end;
$$;
