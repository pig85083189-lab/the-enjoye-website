-- Local-only official Broadcast claim stubs for Phase 3E quota unify.
-- Applied after the delivery-task stub. Never connect to Preview or Production.
-- Formal runtime is opened only in this local TEST stub, never in a migration.

alter table public.line_official_accounts
  add column if not exists bot_display_name text,
  add column if not exists bot_basic_id text,
  add column if not exists broadcast_test_runtime_open boolean not null default false,
  add column if not exists broadcast_formal_runtime_open boolean not null default false;

alter table public.line_broadcasts
  add column if not exists text_body text,
  add column if not exists request_id text,
  add column if not exists line_request_id text,
  add column if not exists api_result text,
  add column if not exists error_message text,
  add column if not exists http_status integer,
  add column if not exists error_class text,
  add column if not exists created_by_staff_id text,
  add column if not exists confirmed_by_staff_id text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.line_broadcast_events (
  id text primary key,
  broadcast_id text,
  organization_id text not null,
  event_type text not null,
  detail text,
  created_by_staff_id text,
  created_at timestamptz not null default now()
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

create or replace function public.line_broadcast_channel_has_inflight(
  p_channel_id text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.line_broadcasts s
    join public.line_official_accounts a
      on a.organization_id = s.organization_id
    where p_channel_id is not null
      and a.channel_id = p_channel_id
      and s.status in ('sending', 'pending_confirmation')
  );
$$;

revoke all on function public.line_broadcast_channel_has_inflight(text)
  from public, anon, authenticated;

-- LOCAL TEST ONLY. Migrations must keep broadcast_formal_runtime_open default false.
update public.line_official_accounts
set
  broadcast_enabled = true,
  broadcast_formal_runtime_open = true,
  bot_display_name = coalesce(bot_display_name, 'enjoye-local'),
  bot_basic_id = coalesce(bot_basic_id, '@enjoye-local')
where organization_id = 'org-the-enjoye';

update public.line_official_accounts
set
  broadcast_enabled = true,
  broadcast_formal_runtime_open = true,
  bot_display_name = coalesce(bot_display_name, 'lumiere-local'),
  bot_basic_id = coalesce(bot_basic_id, '@lumiere-local')
where organization_id = 'org-lumiere';
