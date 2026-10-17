-- Extra local-only fixtures for Phase 2B customer bindings.
-- Applied after the Phase 2A schedule stub. Never connect to Preview or Production.

create extension if not exists pgcrypto;

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

alter table public.customers
  add column if not exists full_name text,
  add column if not exists preferred_name text,
  add column if not exists line_user_id text;

update public.customers
set
  full_name = coalesce(full_name, app_id, id::text),
  preferred_name = coalesce(preferred_name, app_id)
where full_name is null or preferred_name is null;

insert into public.staff_auth_memberships (
  id, user_id, auth_user_id, organization_id, role, display_name, is_active
)
values (
  'mem-enjoye-staff', 'staff-enjoye-staff',
  '33333333-3333-3333-3333-333333333333',
  'org-the-enjoye', 'STAFF', '享悅員工', true
)
on conflict (id) do nothing;

-- Forged CRM identity must never become a trusted binding source.
update public.customers
set line_user_id = 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
where app_id = 'cust-1';
