-- Local-only stubs for Phase 2B.3 Channel lock security tests.
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
  text_body text not null,
  request_id text not null,
  line_request_id text,
  api_result text,
  error_message text,
  http_status integer,
  error_class text,
  created_by_staff_id text not null,
  confirmed_by_staff_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  send_claimed_at timestamptz
);

create table if not exists public.line_broadcast_events (
  id text primary key,
  broadcast_id text,
  organization_id text not null,
  event_type text not null,
  detail text,
  created_by_staff_id text,
  created_at timestamptz not null default now(),
  constraint line_broadcast_events_type_check
    check (event_type in ('draft_saved', 'send_claimed', 'pending_confirmation'))
);

create table if not exists public.line_broadcast_oneshot_permits (
  id text primary key,
  organization_id text not null,
  channel_id text not null,
  bot_display_name text not null,
  bot_basic_id text not null,
  message_sha256 text not null,
  consumed_at timestamptz,
  consumed_broadcast_id text
);

create or replace function public.insert_line_broadcast_event(
  p_organization_id text,
  p_broadcast_id text,
  p_event_type text,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.line_broadcast_events (
    id, broadcast_id, organization_id, event_type, detail
  ) values (
    'lbe-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
    p_broadcast_id,
    p_organization_id,
    p_event_type,
    p_detail
  );
end;
$$;

revoke all on function public.insert_line_broadcast_event(text, text, text, text)
  from public, anon, authenticated;

create or replace function public.line_broadcast_consumed_on_taipei_day(
  p_organization_id text,
  p_at timestamptz default now()
)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.line_broadcasts s
  where s.organization_id = p_organization_id
    and (
      (
        s.send_claimed_at is not null
        and (s.send_claimed_at at time zone 'Asia/Taipei')::date
          = (p_at at time zone 'Asia/Taipei')::date
      )
      or (
        s.send_claimed_at is null
        and s.status in ('accepted', 'sending', 'pending_confirmation')
        and (coalesce(s.confirmed_at, s.created_at) at time zone 'Asia/Taipei')::date
          = (p_at at time zone 'Asia/Taipei')::date
      )
    );
$$;

revoke all on function public.line_broadcast_consumed_on_taipei_day(text, timestamptz)
  from public, anon, authenticated;

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

create or replace function tests.become(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('app.current_uid', coalesce(p_uid::text, ''), false);
end;
$$;
