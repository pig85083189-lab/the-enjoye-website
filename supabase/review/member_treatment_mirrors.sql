-- Review only. This file is not in supabase/migrations and is not applied
-- to production by this pull request.
-- Beauty OS continues to write treatments on the booking project.
-- This finance-project table holds one member-readable copy per booking
-- treatment id. It has no appointment, checkout, wallet, or stored-value keys.
-- Service role may select and insert. It cannot update or delete, so a retry
-- cannot rewrite a row onto another member.

create table if not exists public.member_treatment_mirrors (
  treatment_id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  customer_id uuid not null,
  booking_customer_id uuid not null,
  status text not null default 'COMPLETED' check (status = 'COMPLETED'),
  completed_at timestamptz not null,
  service_name text,
  staff_name text,
  assessment jsonb not null default '{}'::jsonb,
  body_markers jsonb not null default '[]'::jsonb,
  body_map_note text,
  professional_note text,
  client_feeling text,
  discomfort_note text,
  follow_up jsonb not null default '{}'::jsonb,
  products jsonb not null default '[]'::jsonb,
  suggested_tracking_areas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint member_treatment_mirrors_customer_same_org
    foreign key (customer_id, organization_id)
    references public.customers (id, organization_id)
);

alter table public.member_treatment_mirrors enable row level security;
revoke all on public.member_treatment_mirrors from public, anon, authenticated;
grant select, insert on public.member_treatment_mirrors to service_role;

comment on table public.member_treatment_mirrors is
  'Insert-once member copy of a completed booking treatment. Not a second treatment and not a customer merge.';
