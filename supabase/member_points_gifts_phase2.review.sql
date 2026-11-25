-- Phase 2: gift catalog and atomic redemption, server only.
create table public.member_points_gifts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 name text not null check(char_length(name) between 1 and 120),
 description text not null default '',
 image_url text,
 points_cost bigint not null check(points_cost between 1 and 1000000),
 stock integer not null default 0 check(stock>=0),
 active boolean not null default false,
 created_at timestamptz not null default now(),
 unique(organization_id,id)
);
create table public.member_points_redemptions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 customer_id uuid not null,
 gift_id uuid not null,
 request_id uuid not null,
 gift_name text not null,
 points_cost bigint not null check(points_cost>0),
 status text not null default 'issued' check(status in ('issued','used','cancelled')),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 foreign key(organization_id,gift_id) references public.member_points_gifts(organization_id,id),
 foreign key(organization_id,customer_id) references public.member_points_accounts(organization_id,customer_id),
 unique(organization_id,customer_id,request_id)
);
alter table public.member_points_gifts enable row level security;
alter table public.member_points_redemptions enable row level security;
revoke all on public.member_points_gifts,public.member_points_redemptions from public,anon,authenticated;
grant select,insert,update on public.member_points_gifts,public.member_points_redemptions to service_role;
create function public.member_points_redeem(p_org uuid,p_customer uuid,p_gift uuid,p_request uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare g public.member_points_gifts%rowtype; r public.member_points_redemptions%rowtype; rid uuid; b bigint;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_org is null or p_customer is null or p_gift is null or p_request is null then raise exception 'INVALID_REQUEST'; end if;
 perform public.member_points_assert_line_member(p_org,p_customer);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text||':'||p_customer::text||':'||p_request::text,0));
 select * into r from public.member_points_redemptions where organization_id=p_org and customer_id=p_customer and request_id=p_request;
 if found then
 if r.gift_id<>p_gift then raise exception 'REQUEST_CONFLICT'; end if;
 return r.id;
 end if;
 select * into g from public.member_points_gifts where organization_id=p_org and id=p_gift for update;
 if not found or not g.active or g.stock<1 then raise exception 'GIFT_UNAVAILABLE'; end if;
 update public.member_points_accounts set balance=balance-g.points_cost where organization_id=p_org and customer_id=p_customer and balance>=g.points_cost returning balance into b;
 if not found then raise exception 'INSUFFICIENT_POINTS'; end if;
 update public.member_points_gifts set stock=stock-1 where organization_id=p_org and id=p_gift;
 insert into public.member_points_redemptions(organization_id,customer_id,gift_id,request_id,gift_name,points_cost) values(p_org,p_customer,p_gift,p_request,g.name,g.points_cost) returning id into rid;
 insert into public.member_points_entries(organization_id,customer_id,source_key,kind,delta,balance_after,spend_amount,spend_per_point) values(p_org,p_customer,'gift:'||rid,'redeem',-g.points_cost,b,0,1);
 return rid;
end $$;
revoke all on function public.member_points_redeem(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.member_points_redeem(uuid,uuid,uuid,uuid) to service_role;

-- Extend ledger without changing existing earn/reverse semantics.
alter table public.member_points_entries drop constraint member_points_entries_kind_check;
alter table public.member_points_entries drop constraint member_points_entries_check;
alter table public.member_points_entries add constraint member_points_entries_kind_check check(kind in ('earn','reverse','redeem','refund'));
alter table public.member_points_entries add constraint member_points_entries_delta_check check((kind in ('earn','refund') and delta>0) or (kind in ('reverse','redeem') and delta<0));
create function public.member_points_resolve_gift(p_org uuid,p_redemption uuid,p_action text)
returns text language plpgsql security invoker set search_path='' as $$
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
  update public.member_points_accounts set balance=balance+r.points_cost where organization_id=p_org and customer_id=r.customer_id returning balance into b;
  if not found then raise exception 'ACCOUNT_MISSING'; end if;
  update public.member_points_gifts set stock=stock+1 where organization_id=p_org and id=r.gift_id;
  insert into public.member_points_entries(organization_id,customer_id,source_key,kind,delta,balance_after,spend_amount,spend_per_point) values(p_org,r.customer_id,'gift:'||r.id,'refund',r.points_cost,b,0,1);
 end if;
 update public.member_points_redemptions set status=p_action,resolved_at=now() where organization_id=p_org and id=r.id;
 return 'RESOLVED';
end $$;
revoke all on function public.member_points_resolve_gift(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.member_points_resolve_gift(uuid,uuid,text) to service_role;

create function public.member_points_adjust_gift_stock(p_org uuid,p_gift uuid,p_delta integer)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_delta is null or p_delta=0 or p_delta not between -1000000 and 1000000 then raise exception 'INVALID_DELTA'; end if;
 update public.member_points_gifts set stock=stock+p_delta where organization_id=p_org and id=p_gift and stock::bigint+p_delta between 0 and 1000000 returning stock into n;
 if not found then raise exception 'STOCK_ADJUST_FAILED'; end if;
 return n;
end $$;
revoke all on function public.member_points_adjust_gift_stock(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.member_points_adjust_gift_stock(uuid,uuid,integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('member-points-gift-images','member-points-gift-images',true,1500000,array['image/jpeg','image/png','image/webp']);

-- Approved points debt policy: preserve full cancellation ledger.
alter table public.member_points_accounts drop constraint member_points_accounts_balance_check;
alter table public.member_points_entries drop constraint member_points_entries_balance_after_check;
CREATE OR REPLACE FUNCTION public.member_points_apply(p_org uuid, p_customer uuid, p_key text, p_amount bigint, p_completed_at timestamp with time zone, p_reverse boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  update public.member_points_accounts set balance=balance-e.delta where organization_id=p_org and customer_id=e.customer_id returning balance into b;
  if not found then raise exception 'ACCOUNT_MISSING'; end if;
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
end $function$
;
