begin;
-- Apply only after member_daily_reward_claims migration and ledger reader review.
alter table public.member_points_entries drop constraint member_points_entries_kind_check,
 add constraint member_points_entries_kind_check check(kind in ('earn','reverse','redeem','refund','task_reward'));
alter table public.member_points_entries drop constraint member_points_entries_delta_check,
 add constraint member_points_entries_delta_check check((kind in ('earn','refund','task_reward') and delta>0) or (kind in ('reverse','redeem') and delta<0));
grant insert on public.member_daily_reward_claims to service_role;
create function public.member_daily_award_points(p_org uuid,p_customer uuid,p_member_hash text,p_task text)
returns text language plpgsql security invoker set search_path='' as $$
declare rule jsonb; d date := (now() at time zone 'Asia/Taipei')::date; n integer; b bigint; k text; inserted integer;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_member_hash is null or p_member_hash !~ '^[0-9a-f]{64}$' or p_task is null or p_task !~ '^[a-zA-Z0-9_-]{1,80}$' then raise exception 'INVALID_TASK'; end if;
 perform public.member_points_assert_line_member(p_org,p_customer);
 select x into rule from public.member_daily_task_rules t cross join lateral jsonb_array_elements(t.rules) x where t.organization_id=p_org and x->>'id'=p_task;
 if rule is null or rule->>'enabled' is distinct from 'true' or rule->>'reward' is distinct from 'points' then return 'DISABLED'; end if;
 if rule->>'target' is distinct from '1' then return 'UNSUPPORTED'; end if;
 if rule->>'kind'='reading' then
  if not exists(select 1 from public.member_daily_readings where organization_id=p_org and member_hash=p_member_hash and reading_date=d and completed_at is not null) then return 'NOT_COMPLETE'; end if;
 elsif rule->>'kind'='checkin' then
  if not exists(select 1 from public.member_daily_checkins where organization_id=p_org and member_hash=p_member_hash and checkin_date=d) then return 'NOT_COMPLETE'; end if;
 else return 'UNSUPPORTED'; end if;
 n:=(rule->>'amount')::integer;
 if n is null or n<1 or n>100000 then raise exception 'INVALID_REWARD'; end if;
 insert into public.member_daily_reward_claims(organization_id,member_hash,task_id,period_key,reward_kind,reward_amount) values(p_org,p_member_hash,p_task,d::text,'points',n) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return 'ALREADY_CLAIMED'; end if;
 k:='daily:'||p_member_hash||':'||p_task||':'||d::text;
 insert into public.member_points_accounts(organization_id,customer_id) values(p_org,p_customer) on conflict do nothing;
 update public.member_points_accounts set balance=balance+n where organization_id=p_org and customer_id=p_customer returning balance into b;
 if not found then raise exception 'ACCOUNT_MISSING'; end if;
 insert into public.member_points_entries(organization_id,customer_id,source_key,kind,delta,balance_after,spend_amount,spend_per_point) values(p_org,p_customer,k,'task_reward',n,b,0,1);
 return 'AWARDED';
end $$;
revoke all on function public.member_daily_award_points(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.member_daily_award_points(uuid,uuid,text,text) to service_role;
-- Caller must resolve the customer and member hash from the same verified LINE session.
-- No public endpoint or enable switch until identity binding and transaction tests pass.
commit;
