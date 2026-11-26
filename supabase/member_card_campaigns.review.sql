create table public.member_card_campaigns (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(char_length(title) between 1 and 100), image_url text not null default '',
 background text not null check(background ~ '^#[0-9a-fA-F]{6}$'), foreground text not null check(foreground ~ '^#[0-9a-fA-F]{6}$'),
 subtitle text not null check(char_length(subtitle)<=80), enabled boolean not null default false,
 starts_on date, ends_on date, priority integer not null default 0 check(priority between -1000 and 1000),
 created_at timestamptz not null default now(),
 check((starts_on is null and ends_on is null) or (starts_on is not null and ends_on is not null and ends_on>=starts_on))
);
alter table public.member_card_campaigns enable row level security;
revoke all on public.member_card_campaigns from public,anon,authenticated;
grant select,insert,update,delete on public.member_card_campaigns to service_role;
create index member_card_campaigns_org_idx on public.member_card_campaigns(organization_id,enabled,priority);
