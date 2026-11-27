begin;
-- Review only: member display and checkout integration must be verified before activation.
create table public.member_daily_vouchers (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 customer_id uuid not null references public.customers(id),
 member_hash text not null,
 task_id text not null,
 period_key text not null,
 title text not null check(length(btrim(title)) between 1 and 120),
 status text not null default 'issued' check(status in ('issued','used','cancelled')),
 issued_at timestamptz not null default now(),
 expires_on date not null,
 resolved_at timestamptz,
 unique(organization_id,member_hash,task_id,period_key)
);
alter table public.member_daily_vouchers enable row level security;
revoke all on public.member_daily_vouchers from public,anon,authenticated;
grant select on public.member_daily_vouchers to service_role;
create function public.member_daily_award_voucher(p_org uuid,p_customer uuid,p_member_hash text,p_task text,p_line_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare rule jsonb; d date := (now() at time zone 'Asia/Taipei')::date; n integer; voucher_name text; valid_days integer; inserted integer; k text;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_line_hash is null or p_line_hash !~ '^[0-9a-f]{64} or p_member_hash !~ '^[0-9a-f]{64}$' or p_task is null or p_task !~ '^[a-zA-Z0-9_-]{1,80}$' then raise exception 'INVALID_TASK'; end if;
 perform public.member_points_assert_line_member(p_org,p_customer);
 -- The existing assertion holds identity locks and establishes exactly one valid hash.
 -- The trusted server derives both hashes from the same authenticated LINE subject.
 if not exists (
  with b as (
   select lower(btrim(l.line_user_id_hash)) as hash,l.status,l.verified,l.confirmed_at,l.bound_at,l.unbound_at,l.blocked_at
   from public.line_customer_bindings l join public.organizations o on o.app_id=l.organization_id
   where o.id=p_org and l.customer_uuid=p_customer
  ), candidates as (
   select lower(btrim(line_subject_hash)) as hash from public.member_line_customer_links
   where organization_id=p_org and customer_id=p_customer and verified_at is not null
   union select hash from b where status='active' and verified and confirmed_at is not null and bound_at is not null and unbound_at is null and blocked_at is null
  )
  select 1 from candidates c where c.hash=p_line_hash and not exists (
   select 1 from b r where r.hash=c.hash and (r.status='unbound' or r.unbound_at is not null or r.blocked_at is not null)
   and not exists(select 1 from b v where v.hash=r.hash and v.status='active' and v.verified and v.confirmed_at is not null and v.bound_at is not null and v.unbound_at is null and v.blocked_at is null and v.bound_at>greatest(coalesce(r.unbound_at,'-infinity'),coalesce(r.blocked_at,'-infinity')))
  )
 ) then raise exception 'TASK_MEMBER_MISMATCH'; end if;
 select x into rule from public.member_daily_task_rules t cross join lateral jsonb_array_elements(t.rules) x where t.organization_id=p_org and x->>'id'=p_task;
 if rule is null or rule->>'enabled' is distinct from 'true' or rule->>'reward' is distinct from 'voucher' then return 'DISABLED'; end if;
 if rule->>'target' is distinct from '1' then return 'UNSUPPORTED'; end if;
 if rule->>'kind'='reading' then
  if not exists(select 1 from public.member_daily_readings where organization_id=p_org and member_hash=p_member_hash and reading_date=d and completed_at is not null) then return 'NOT_COMPLETE'; end if;
 elsif rule->>'kind'='checkin' then
  if not exists(select 1 from public.member_daily_checkins where organization_id=p_org and member_hash=p_member_hash and checkin_date=d) then return 'NOT_COMPLETE'; end if;
 else return 'UNSUPPORTED'; end if;


 n:=(rule->>'amount')::integer;
 voucher_name:=btrim(rule->>'voucherTitle');
 valid_days:=(rule->>'validDays')::integer;
 if n is distinct from 1 or voucher_name is null or length(voucher_name) not between 1 and 120 or valid_days is null or valid_days not between 1 and 365 then raise exception 'INVALID_REWARD'; end if;
 insert into public.member_daily_reward_claims(organization_id,member_hash,task_id,period_key,reward_kind,reward_amount) values(p_org,p_member_hash,p_task,d::text,'voucher',1) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return 'ALREADY_CLAIMED'; end if;
 insert into public.member_daily_vouchers(organization_id,customer_id,member_hash,task_id,period_key,title,expires_on) values(p_org,p_customer,p_member_hash,p_task,d::text,voucher_name,d+valid_days-1);
 return 'AWARDED';
end $$;
revoke all on function public.member_daily_award_voucher(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.member_daily_award_voucher(uuid,uuid,text,text,text) to service_role;
commit;
