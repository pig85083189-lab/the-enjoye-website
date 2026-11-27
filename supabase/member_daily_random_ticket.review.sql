begin;
alter table public.member_points_redemptions add column daily_task_reward boolean not null default false;
alter table public.member_points_redemptions drop constraint member_points_redemptions_points_cost_check, add constraint member_points_redemptions_points_cost_check check ((daily_task_reward and points_cost=0) or (not daily_task_reward and points_cost>0));
CREATE OR REPLACE FUNCTION public.member_points_resolve_gift(p_org uuid, p_redemption uuid, p_action text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.member_points_redemptions%rowtype; b bigint;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_action is null or p_action not in ('used','cancelled') then raise exception 'INVALID_ACTION'; end if;
 select * into r from public.member_points_redemptions where organization_id=p_org and id=p_redemption for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if r.status=p_action then return 'ALREADY_RESOLVED'; end if;
 if r.status<>'issued' then raise exception 'ALREADY_RESOLVED_DIFFERENT_ACTION'; end if;
 if p_action='cancelled' then
  perform 1 from public.member_points_gifts where organization_id=p_org and id=r.gift_id for update;
  if not r.daily_task_reward then
  update public.member_points_accounts set balance=balance+r.points_cost where organization_id=p_org and customer_id=r.customer_id returning balance into b;
  if not found then raise exception 'ACCOUNT_MISSING'; end if;

  insert into public.member_points_entries(organization_id,customer_id,source_key,kind,delta,balance_after,spend_amount,spend_per_point) values(p_org,r.customer_id,'gift:'||r.id,'refund',r.points_cost,b,0,1);
  end if;
  update public.member_points_gifts set stock=stock+1 where organization_id=p_org and id=r.gift_id;
 end if;
 update public.member_points_redemptions set status=p_action,resolved_at=now() where organization_id=p_org and id=r.id;
 return 'RESOLVED';
end $function$
;
create function public.member_daily_award_voucher(p_org uuid,p_customer uuid,p_member_hash text,p_task text,p_line_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare rule jsonb; d date := (now() at time zone 'Asia/Taipei')::date; n integer; candidate record; awarded boolean:=false; inserted integer; k text;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_line_hash is null or p_line_hash !~ '^[0-9a-f]{64}$' or p_member_hash is null or p_member_hash !~ '^[0-9a-f]{64}$' or p_task is null or p_task !~ '^[a-zA-Z0-9_-]{1,80}$' then raise exception 'INVALID_TASK'; end if;
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
 if n is distinct from 1 then raise exception 'INVALID_REWARD'; end if;
 insert into public.member_daily_reward_claims(organization_id,member_hash,task_id,period_key,reward_kind,reward_amount) values(p_org,p_member_hash,p_task,d::text,'voucher',1) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return 'ALREADY_CLAIMED'; end if;
 for candidate in select * from (
 select 'points' as source,g.id from public.member_points_gifts g where g.organization_id=p_org and g.active and g.stock>0
 union all select 'draw',p.id from public.lucky_draw_campaign_prizes p join public.lucky_draw_campaigns c on c.id=p.campaign_id and c.organization_id=p.organization_id where p.organization_id=p_org and p.remaining_stock>0 and c.status='active' and d between c.starts_on and c.ends_on
 ) pool order by random() loop
 if candidate.source='points' then
 update public.member_points_gifts set stock=stock-1 where organization_id=p_org and id=candidate.id and active and stock>0;
 if not found then continue; end if;
 insert into public.member_points_accounts(organization_id,customer_id,balance) values(p_org,p_customer,0) on conflict do nothing;
 insert into public.member_points_redemptions(organization_id,customer_id,gift_id,request_id,gift_name,points_cost,daily_task_reward) select p_org,p_customer,id,gen_random_uuid(),name,0,true from public.member_points_gifts where id=candidate.id and organization_id=p_org;
 else
 perform 1 from public.lucky_draw_campaigns c join public.lucky_draw_campaign_prizes p on p.campaign_id=c.id and p.organization_id=c.organization_id where p.id=candidate.id and c.organization_id=p_org and c.status='active' and d between c.starts_on and c.ends_on for update of c;
 if not found then continue; end if;
 update public.lucky_draw_campaign_prizes set remaining_stock=remaining_stock-1 where organization_id=p_org and id=candidate.id and remaining_stock>0;
 if not found then continue; end if;
 insert into public.lucky_draw_chance_accounts(organization_id,customer_id,campaign_id,balance) select p_org,p_customer,campaign_id,0 from public.lucky_draw_campaign_prizes where id=candidate.id on conflict do nothing;
 insert into public.lucky_draw_results(organization_id,customer_id,campaign_id,request_id,prize_id,prize_name,prize_tier) select p_org,p_customer,campaign_id,gen_random_uuid(),id,name,tier from public.lucky_draw_campaign_prizes where id=candidate.id and organization_id=p_org;
 end if;
 return 'AWARDED';
 end loop;
 delete from public.member_daily_reward_claims where organization_id=p_org and member_hash=p_member_hash and task_id=p_task and period_key=d::text;
 return 'NO_STOCK';
end $$;
revoke all on function public.member_daily_award_voucher(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.member_daily_award_voucher(uuid,uuid,text,text,text) to service_role;
commit;
