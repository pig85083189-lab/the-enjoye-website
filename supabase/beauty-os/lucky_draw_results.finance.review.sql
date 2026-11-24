begin;
create table public.lucky_draw_results (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 customer_id uuid not null,
 campaign_id uuid not null,
 request_id uuid not null,
 prize_id uuid not null references public.lucky_draw_campaign_prizes(id),
 prize_name text not null,
 prize_tier text not null check(prize_tier in ('大獎','二獎','參獎','小獎')),
 created_at timestamptz not null default now(),
 unique(organization_id,campaign_id,request_id),
 foreign key(organization_id,customer_id,campaign_id) references public.lucky_draw_chance_accounts(organization_id,customer_id,campaign_id)
);
alter table public.lucky_draw_results enable row level security;
revoke all on public.lucky_draw_results from public,anon,authenticated,service_role;
commit;