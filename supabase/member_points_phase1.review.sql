-- Review migration: independent member points ledger. Disabled until integration is verified.
create table public.member_points_settings (
 organization_id uuid primary key references public.organizations(id),
 enabled boolean not null default false,
 spend_per_point bigint not null default 100 check (spend_per_point > 0),
 enabled_at timestamptz,
 updated_at timestamptz not null default now(),
 check (not enabled or enabled_at is not null)
);
create table public.member_points_settings_history (
 organization_id uuid not null references public.organizations(id),
 effective_at timestamptz not null default clock_timestamp(),
 enabled boolean not null,
 spend_per_point bigint not null check(spend_per_point>0),
 primary key(organization_id,effective_at)
);
alter table public.member_points_settings_history enable row level security;
revoke all on public.member_points_settings_history from public,anon,authenticated;
grant select,insert on public.member_points_settings_history to service_role;
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

create table public.member_points_cancellations (
 organization_id uuid not null references public.organizations(id),
 source_key text not null,
 primary key(organization_id,source_key)
);
alter table public.member_points_cancellations enable row level security;
revoke all on public.member_points_cancellations from public,anon,authenticated;
grant select,insert on public.member_points_cancellations to service_role;

create function public.member_points_assert_line_member(p_org uuid,p_customer uuid)
returns void language plpgsql security definer set search_path='' as $identity$
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 perform lucky_draw_private.assert_line_member(p_org,p_customer);
end $identity$;
revoke all on function public.member_points_assert_line_member(uuid,uuid) from public,anon,authenticated;
grant execute on function public.member_points_assert_line_member(uuid,uuid) to service_role;

create function public.member_points_apply(p_org uuid,p_customer uuid,p_key text,p_amount bigint,p_completed_at timestamptz,p_reverse boolean default false)
returns text language plpgsql security invoker set search_path='' as $$
declare e public.member_points_entries%rowtype; s public.member_points_settings_history%rowtype; n bigint; b bigint;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_org is null or p_key is null or p_key !~ '^(booking|finance):[0-9a-f-]{36}$' or p_reverse is null then raise exception 'INVALID_EVENT'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text||':'||p_key,0));
 select * into e from public.member_points_entries where organization_id=p_org and source_key=p_key and kind='earn';
 if p_reverse then
  insert into public.member_points_cancellations values(p_org,p_key) on conflict do nothing;
  if e.id is null then return 'CANCELLED_BEFORE_EARN'; end if;
  if exists(select 1 from public.member_points_entries where organization_id=p_org and source_key=p_key and kind='reverse') then return 'ALREADY_REVERSED'; end if;
  update public.member_points_accounts set balance=balance-e.delta where organization_id=p_org and customer_id=e.customer_id and balance>=e.delta returning balance into b;
  if not found then return 'REVIEW_INSUFFICIENT_BALANCE'; end if;
  insert into public.member_points_entries(organization_id,customer_id,source_key,kind,delta,balance_after,spend_amount,spend_per_point) values(p_org,e.customer_id,p_key,'reverse',-e.delta,b,e.spend_amount,e.spend_per_point);
  return 'REVERSED';
 end if;
 if exists(select 1 from public.member_points_cancellations where organization_id=p_org and source_key=p_key) then return 'CANCELLED'; end if;
 if p_customer is null or p_amount is null or p_amount<0 or p_completed_at is null or p_completed_at>now() then raise exception 'INVALID_EVENT'; end if;
 if e.id is not null then
  if e.customer_id is distinct from p_customer or e.spend_amount is distinct from p_amount then raise exception 'EVENT_CONFLICT'; end if;
  return 'ALREADY_EARNED';
 end if;
 select * into s from public.member_points_settings_history where organization_id=p_org and effective_at<=p_completed_at order by effective_at desc limit 1;
 if not found or not s.enabled then return 'DISABLED'; end if;
 perform public.member_points_assert_line_member(p_org,p_customer);
 n:=p_amount/s.spend_per_point;
 if n=0 then return 'NO_POINTS'; end if;
 insert into public.member_points_accounts(organization_id,customer_id) values(p_org,p_customer) on conflict do nothing;
 update public.member_points_accounts set balance=balance+n where organization_id=p_org and customer_id=p_customer returning balance into b;
 insert into public.member_points_entries(organization_id,customer_id,source_key,kind,delta,balance_after,spend_amount,spend_per_point) values(p_org,p_customer,p_key,'earn',n,b,p_amount,s.spend_per_point);
 return 'EARNED';
end $$;
revoke all on function public.member_points_apply(uuid,uuid,text,bigint,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.member_points_apply(uuid,uuid,text,bigint,timestamptz,boolean) to service_role;
-- Internal primitive only: callers must verify current cross-database identity and authoritative settlement before invoking.

create function public.member_points_save_settings(p_org uuid,p_enabled boolean,p_spend bigint)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_org is null or p_enabled is null or p_spend is null or p_spend not between 1 and 1000000 then raise exception 'INVALID_SETTINGS'; end if;
 insert into public.member_points_settings(organization_id,enabled,spend_per_point,enabled_at)
 values(p_org,p_enabled,p_spend,case when p_enabled then now() else null end)
 on conflict(organization_id) do update set enabled=excluded.enabled,spend_per_point=excluded.spend_per_point,
 enabled_at=case when excluded.enabled and not public.member_points_settings.enabled then now() else public.member_points_settings.enabled_at end,updated_at=now();
 insert into public.member_points_settings_history(organization_id,enabled,spend_per_point) values(p_org,p_enabled,p_spend);
end $$;
revoke all on function public.member_points_save_settings(uuid,boolean,bigint) from public,anon,authenticated;
grant execute on function public.member_points_save_settings(uuid,boolean,bigint) to service_role;
