create table public.checkout_voucher_intents (
 organization_id uuid not null, customer_id uuid not null, checkout_app_id text not null, tickets jsonb not null, completed boolean not null default false, primary key(organization_id,checkout_app_id)
);
alter table public.checkout_voucher_intents enable row level security;
revoke all on public.checkout_voucher_intents from public,anon,authenticated;
grant select,insert,update on public.checkout_voucher_intents to service_role;
create function public.prepare_checkout_vouchers(p_org uuid,p_customer uuid,p_checkout text,p_tickets jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare t record; normalized jsonb;
begin
if p_org is null or p_customer is null or p_checkout is null or length(p_checkout) not between 1 and 120 or jsonb_typeof(p_tickets) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
if jsonb_array_length(p_tickets) not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
for t in select distinct x.source,x.id from jsonb_to_recordset(p_tickets) x(source text,id uuid) loop
if t.source='draw' then
 if not exists(select 1 from public.lucky_draw_results where organization_id=p_org and customer_id=p_customer and id=t.id and voucher_status='issued') then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
elsif t.source='points' then
 if not exists(select 1 from public.member_points_redemptions where organization_id=p_org and customer_id=p_customer and id=t.id and status='issued') then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
else raise exception 'INVALID_TICKET'; end if;
end loop;
select jsonb_agg(jsonb_build_object('source',x.source,'id',x.id) order by x.source,x.id) into normalized from (select distinct source,id from jsonb_to_recordset(p_tickets) as r(source text,id uuid)) x;
insert into public.checkout_voucher_intents(organization_id,customer_id,checkout_app_id,tickets) values(p_org,p_customer,p_checkout,normalized) on conflict(organization_id,checkout_app_id) do update set tickets=excluded.tickets where checkout_voucher_intents.customer_id=excluded.customer_id and not checkout_voucher_intents.completed;
if not found then raise exception 'INTENT_CONFLICT'; end if;
return true;
end; $$;
create function public.finish_checkout_vouchers(p_org uuid,p_customer uuid,p_checkout text,p_tickets jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare v public.checkout_voucher_intents%rowtype; normalized jsonb; n integer;
begin
select * into v from public.checkout_voucher_intents where organization_id=p_org and customer_id=p_customer and checkout_app_id=p_checkout for update;
if not found then raise exception 'INTENT_NOT_FOUND'; end if;
select jsonb_agg(jsonb_build_object('source',x.source,'id',x.id) order by x.source,x.id) into normalized from (select distinct source,id from jsonb_to_recordset(p_tickets) as r(source text,id uuid)) x;
if normalized is distinct from v.tickets then raise exception 'INTENT_MISMATCH'; end if;
n:=public.redeem_checkout_vouchers(p_org,p_customer,p_checkout,v.tickets);
update public.checkout_voucher_intents set completed=true where organization_id=p_org and checkout_app_id=p_checkout;
return n;
end; $$;
revoke all on function public.prepare_checkout_vouchers(uuid,uuid,text,jsonb),public.finish_checkout_vouchers(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_checkout_vouchers(uuid,uuid,text,jsonb),public.finish_checkout_vouchers(uuid,uuid,text,jsonb) to service_role;