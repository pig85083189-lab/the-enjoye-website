-- Run in the same Supabase project used by Beauty OS staff authentication.
create table if not exists public.staff_password_reset_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  actor_auth_user_id uuid not null,
  target_auth_user_id uuid not null,
  target_membership_id text not null,
  status text not null check (status in ('attempted', 'succeeded', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists staff_password_reset_audit_org_created_idx
  on public.staff_password_reset_audit (organization_id, created_at desc);
alter table public.staff_password_reset_audit enable row level security;
-- No policies: authenticated and anon clients cannot access audit records.
revoke all on public.staff_password_reset_audit from anon, authenticated;
grant select, insert, update on public.staff_password_reset_audit to service_role;
-- No password, token, or secret is stored in audit records.
