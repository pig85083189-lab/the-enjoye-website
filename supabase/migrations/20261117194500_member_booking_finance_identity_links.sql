-- Cross-database LINE identity association. No customer merge or wallet mutation.
-- Booking customer UUID is an external identifier, not a foreign key in this database.
create table if not exists public.member_booking_finance_identity_links (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 booking_organization_id uuid not null,
 booking_customer_id uuid not null,
 finance_customer_id uuid not null references public.customers(id),
 evidence_kind text not null check (evidence_kind = 'SAME_VERIFIED_LINE_SUBJECT_AND_STAFF_CONFIRMATION'),
 finance_confirmation_id uuid not null references public.member_finance_binding_challenges(id),
 verified_at timestamptz not null,
 created_at timestamptz not null default now(),
 revoked_at timestamptz,
 constraint distinct_booking_finance_customer unique (organization_id,booking_organization_id,booking_customer_id),
 constraint distinct_finance_booking_customer unique (organization_id,finance_customer_id)
);
create index if not exists member_booking_finance_identity_links_active_idx
 on public.member_booking_finance_identity_links(organization_id,finance_customer_id)
 where revoked_at is null;
alter table public.member_booking_finance_identity_links enable row level security;
revoke all on public.member_booking_finance_identity_links from public,anon,authenticated;
grant select,insert,update on public.member_booking_finance_identity_links to service_role;
comment on table public.member_booking_finance_identity_links is
 'Explicit LINE-verified mapping between independent booking and finance customers. Not authorization by itself: read paths must re-check both live LINE scopes and revocation.';
