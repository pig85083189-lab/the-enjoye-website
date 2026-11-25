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
