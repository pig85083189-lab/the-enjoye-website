begin;
create table public.member_daily_task_rules (
 organization_id uuid primary key references public.organizations(id),
 rules jsonb not null default '[]'::jsonb check(jsonb_typeof(rules)='array' and jsonb_array_length(rules)<=100),
 updated_at timestamptz not null default now()
);
alter table public.member_daily_task_rules enable row level security;
revoke all on public.member_daily_task_rules from public,anon,authenticated;
grant select,insert,update on public.member_daily_task_rules to service_role;
commit;
