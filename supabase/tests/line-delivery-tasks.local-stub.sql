-- Local-only fixtures for the shared LINE delivery task ledger.
-- Applied after schedule + binding stubs. Never connect to Preview or Production.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create table if not exists public.line_official_accounts (
  organization_id text primary key,
  channel_id text,
  broadcast_enabled boolean not null default false
);

create table if not exists public.line_broadcasts (
  id text primary key,
  organization_id text not null,
  status text not null default 'draft',
  send_claimed_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.line_official_accounts (organization_id, channel_id, broadcast_enabled)
values
  ('org-the-enjoye', '2000000001', true),
  ('org-lumiere', '2000000002', false)
on conflict (organization_id) do update
set broadcast_enabled = excluded.broadcast_enabled;

-- Mirror the official helper so quota_used takes the real function path.
-- Counts only line_broadcasts. Never counts line_delivery_tasks.
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

insert into public.staff_auth_memberships (
  id, user_id, auth_user_id, organization_id, role, display_name, is_active
) values (
  'mem-enjoye-staff', 'staff-enjoye-staff',
  '33333333-3333-3333-3333-333333333333',
  'org-the-enjoye', 'STAFF', '享悅員工', true
)
on conflict (id) do nothing;
