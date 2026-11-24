-- Finance project only. No live grants or draws enabled by this schema.
begin;
create table public.lucky_draw_chance_accounts (
 organization_id uuid not null references public.organizations(id),
 customer_id uuid not null references public.customers(id),
 campaign_id uuid not null,
 balance bigint not null default 0 check (balance >= 0),
 primary key (organization_id, customer_id, campaign_id)
);
create table public.lucky_draw_chance_entries (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 customer_id uuid not null,
 campaign_id uuid not null,
 source text not null check (source in ('spend','points','treatment','birthday','manual','draw','reversal')),
 source_key text not null check (length(btrim(source_key)) between 1 and 300),
 delta integer not null check (delta <> 0),
 actor_id text,
 reason text,
 created_at timestamptz not null default now(),
 foreign key (organization_id,customer_id,campaign_id) references public.lucky_draw_chance_accounts(organization_id,customer_id,campaign_id),
 unique (organization_id,campaign_id,source,source_key),
 check ((source in ('draw','reversal') and delta < 0) or (source not in ('draw','reversal') and delta > 0)),
 check (source <> 'manual' or (actor_id is not null and length(btrim(coalesce(reason,''))) > 0))
);
alter table public.lucky_draw_chance_accounts enable row level security;
alter table public.lucky_draw_chance_entries enable row level security;
revoke all on public.lucky_draw_chance_accounts, public.lucky_draw_chance_entries from public, anon, authenticated, service_role;
-- No API writes until member identity, campaign publication and atomic grant/draw RPCs are implemented.
commit;
