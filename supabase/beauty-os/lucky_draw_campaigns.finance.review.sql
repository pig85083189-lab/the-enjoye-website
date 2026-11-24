-- Finance database. Review before applying; no public API access.
begin;
create table public.lucky_draw_campaigns (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 version integer not null check(version>0),
 name text not null check(length(btrim(name)) between 1 and 200),
 starts_on date not null,
 ends_on date not null check(ends_on>=starts_on),
 rules jsonb not null check(jsonb_typeof(rules)='object'),
 status text not null default 'paused' check(status in ('active','paused','ended')),
 published_by text not null check(length(btrim(published_by))>0),
 published_at timestamptz not null default now(),
 unique(organization_id,version),
 unique(organization_id,id)
);
create unique index lucky_draw_one_open_campaign on public.lucky_draw_campaigns(organization_id) where status in ('active','paused');
create table public.lucky_draw_campaign_prizes (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 campaign_id uuid not null,
 tier text not null check(tier in ('大獎','二獎','參獎','小獎')),
 name text not null check(length(btrim(name)) between 1 and 200),
 odds_bps integer not null check(odds_bps between 0 and 10000),
 initial_stock bigint not null check(initial_stock>=0),
 remaining_stock bigint not null check(remaining_stock between 0 and initial_stock),
 check(odds_bps=0 or initial_stock>0),
 foreign key(organization_id,campaign_id) references public.lucky_draw_campaigns(organization_id,id)
);
alter table public.lucky_draw_campaigns enable row level security;
alter table public.lucky_draw_campaign_prizes enable row level security;
revoke all on public.lucky_draw_campaigns,public.lucky_draw_campaign_prizes from public,anon,authenticated,service_role;
-- Publication must validate total odds and rules in one transaction.
-- Lifecycle and inventory writes require separately authorized RPCs.
commit;
