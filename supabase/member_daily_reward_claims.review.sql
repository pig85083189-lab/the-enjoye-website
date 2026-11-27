begin;
create table public.member_daily_reward_claims (
 organization_id uuid not null references public.organizations(id),
 member_hash text not null check(member_hash ~ '^[0-9a-f]{64}$'),
 task_id text not null check(task_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
 period_key text not null check(length(period_key) between 1 and 80),
 reward_kind text not null check(reward_kind in ('points','voucher','draw')),
 reward_amount integer not null check(reward_amount between 1 and 100000),
 created_at timestamptz not null default now(),
 primary key(organization_id,member_hash,task_id,period_key)
);
alter table public.member_daily_reward_claims enable row level security;
revoke all on public.member_daily_reward_claims from public,anon,authenticated;
grant select on public.member_daily_reward_claims to service_role;
-- No insert grant or reward execution function until the existing financial
-- ledger integration is reviewed and tested in a single transaction.
commit;
