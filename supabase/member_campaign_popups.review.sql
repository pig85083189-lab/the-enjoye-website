create table public.member_campaign_popups (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 title text not null check (char_length(title) between 1 and 120),
 image_url text not null,
 href text not null default '',
 button_label text not null default '立即了解活動',
 enabled boolean not null default false,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 frequency text not null default 'daily' check(frequency in ('daily','session','once')),
 allow_dismiss boolean not null default true,
 priority integer not null default 0,
 created_at timestamptz not null default now(),
 check(ends_at > starts_at)
);
alter table public.member_campaign_popups enable row level security;
revoke all on public.member_campaign_popups from public,anon,authenticated;
grant select,insert,update,delete on public.member_campaign_popups to service_role;
create index member_campaign_popups_org_idx on public.member_campaign_popups(organization_id,enabled,priority);
