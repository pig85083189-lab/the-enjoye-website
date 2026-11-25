-- Review migration: independent member points ledger. Disabled until integration is verified.
create table public.member_points_settings (
 organization_id uuid primary key references public.organizations(id),
 enabled boolean not null default false,
 spend_per_point bigint not null default 100 check (spend_per_point > 0),
 enabled_at timestamptz,
 updated_at timestamptz not null default now(),
 check (not enabled or enabled_at is not null)
);
create table public.member_points_accounts (
 organization_id uuid not null references public.organizations(id),
 customer_id uuid not null references public.customers(id),
 balance bigint not null default 0 check (balance >= 0),
 primary key (organization_id, customer_id)
);
create table public.member_points_entries (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 customer_id uuid not null,
 source_key text not null,
 kind text not null check (kind in ('earn','reverse')),
 delta bigint not null,
 balance_after bigint not null check (balance_after >= 0),
 spend_amount bigint not null check (spend_amount >= 0),
 spend_per_point bigint not null check (spend_per_point > 0),
 created_at timestamptz not null default now(),
 foreign key (organization_id,customer_id) references public.member_points_accounts(organization_id,customer_id),
 unique (organization_id,source_key,kind),
 check ((kind='earn' and delta>0) or (kind='reverse' and delta<0))
);
alter table public.member_points_settings enable row level security;
alter table public.member_points_accounts enable row level security;
alter table public.member_points_entries enable row level security;
revoke all on public.member_points_settings,public.member_points_accounts,public.member_points_entries from public,anon,authenticated;
grant select,insert,update on public.member_points_settings,public.member_points_accounts to service_role;
grant select,insert on public.member_points_entries to service_role;
create index member_points_entries_customer_history_idx on public.member_points_entries(organization_id,customer_id,created_at desc,id);
-- No browser grants, no existing table changes, no historical backfill.
