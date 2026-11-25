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
declare g public.member_points_gifts%rowtype; r public.member_points_redemptions%rowtype; rid uuid;
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
 update public.member_points_accounts set balance=balance-g.points_cost where organization_id=p_org and customer_id=p_customer and balance>=g.points_cost;
 if not found then raise exception 'INSUFFICIENT_POINTS'; end if;
 update public.member_points_gifts set stock=stock-1 where organization_id=p_org and id=p_gift;
 insert into public.member_points_redemptions(organization_id,customer_id,gift_id,request_id,gift_name,points_cost) values(p_org,p_customer,p_gift,p_request,g.name,g.points_cost) returning id into rid;
 return rid;
end $$;
revoke all on function public.member_points_redeem(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.member_points_redeem(uuid,uuid,uuid,uuid) to service_role;
