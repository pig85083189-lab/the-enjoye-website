create table if not exists public.staff_consultation_settings (
  organization_id text primary key,
  fields jsonb not null default '[]'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint staff_consultation_fields_array check (jsonb_typeof(fields) = 'array'),
  constraint staff_consultation_fields_size check (octet_length(fields::text) <= 65536)
);
alter table public.staff_consultation_settings enable row level security;
revoke all on public.staff_consultation_settings from public, anon, authenticated;
-- Access is exclusively via authenticated server routes with membership checks.
grant select, insert, update on public.staff_consultation_settings to service_role;
