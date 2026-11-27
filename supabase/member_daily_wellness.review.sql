begin;
create table public.member_daily_card_settings (
 organization_id uuid primary key references public.organizations(id),
 cards jsonb not null default '[]'::jsonb check (jsonb_typeof(cards)='array' and jsonb_array_length(cards)<=500),
 updated_at timestamptz not null default now()
);
create table public.member_daily_readings (
 organization_id uuid not null references public.organizations(id),
 member_hash text not null check (member_hash ~ '^[0-9a-f]{64}$'),
 reading_date date not null,
 cards jsonb not null check (jsonb_typeof(cards)='array' and jsonb_array_length(cards)=3),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 primary key (organization_id,member_hash,reading_date)
);
create table public.member_daily_checkins (
 organization_id uuid not null references public.organizations(id),
 member_hash text not null check (member_hash ~ '^[0-9a-f]{64}$'),
 checkin_date date not null,
 created_at timestamptz not null default now(),
 primary key (organization_id,member_hash,checkin_date)
);
alter table public.member_daily_card_settings enable row level security;
alter table public.member_daily_readings enable row level security;
alter table public.member_daily_checkins enable row level security;
revoke all on public.member_daily_card_settings,public.member_daily_readings,public.member_daily_checkins from public,anon,authenticated;
grant select,insert,update on public.member_daily_card_settings,public.member_daily_readings to service_role;
grant select,insert on public.member_daily_checkins to service_role;
commit;
