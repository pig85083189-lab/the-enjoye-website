begin;
alter table public.checkout_voucher_redemptions drop constraint checkout_voucher_redemptions_source_check, add constraint checkout_voucher_redemptions_source_check check(source in ('draw','points','task_reward'));
grant update(status,resolved_at) on public.member_daily_vouchers to service_role;
CREATE OR REPLACE FUNCTION public.prepare_checkout_vouchers(p_org uuid, p_customer uuid, p_checkout text, p_tickets jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t record; normalized jsonb;
begin
if p_org is null or p_customer is null or p_checkout is null or length(p_checkout) not between 1 and 120 or jsonb_typeof(p_tickets) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
if jsonb_array_length(p_tickets) not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
for t in select distinct x.source,x.id from jsonb_to_recordset(p_tickets) x(source text,id uuid) loop
if t.source='draw' then
 if not exists(select 1 from public.lucky_draw_results where organization_id=p_org and customer_id=p_customer and id=t.id and voucher_status='issued') then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
elsif t.source='points' then
 if not exists(select 1 from public.member_points_redemptions where organization_id=p_org and customer_id=p_customer and id=t.id and status='issued') then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
elsif t.source='task_reward' then
 if not exists(select 1 from public.member_daily_vouchers where organization_id=p_org and customer_id=p_customer and id=t.id and status='issued' and expires_on >= (now() at time zone 'Asia/Taipei')::date) then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
else raise exception 'INVALID_TICKET'; end if;
end loop;
select jsonb_agg(jsonb_build_object('source',x.source,'id',x.id) order by x.source,x.id) into normalized from (select distinct source,id from jsonb_to_recordset(p_tickets) as r(source text,id uuid)) x;
insert into public.checkout_voucher_intents(organization_id,customer_id,checkout_app_id,tickets) values(p_org,p_customer,p_checkout,normalized) on conflict(organization_id,checkout_app_id) do update set tickets=excluded.tickets where checkout_voucher_intents.customer_id=excluded.customer_id and not checkout_voucher_intents.completed;
if not found then raise exception 'INTENT_CONFLICT'; end if;
return true;
end; $function$
;
CREATE OR REPLACE FUNCTION public.redeem_checkout_vouchers(p_org uuid, p_customer uuid, p_checkout text, p_tickets jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t record; n integer:=0; existing text; affected integer;
begin
 if p_org is null or p_customer is null or p_checkout is null or length(p_checkout) not between 1 and 120 or jsonb_typeof(p_tickets) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_tickets) not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
 for t in select distinct x.source,x.id from jsonb_to_recordset(p_tickets) as x(source text,id uuid) order by x.source,x.id loop
 if t.source is null or t.source not in ('draw','points','task_reward') or t.id is null then raise exception 'INVALID_TICKET'; end if;
 insert into public.checkout_voucher_redemptions(organization_id,customer_id,checkout_app_id,source,voucher_id) values(p_org,p_customer,p_checkout,t.source,t.id) on conflict do nothing;
 get diagnostics affected=row_count;
 if affected=0 then
 select checkout_app_id into existing from public.checkout_voucher_redemptions where organization_id=p_org and customer_id=p_customer and source=t.source and voucher_id=t.id;
 if existing is distinct from p_checkout then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
 else
 if t.source='draw' then
 update public.lucky_draw_results set voucher_status='used',voucher_resolved_at=now() where organization_id=p_org and customer_id=p_customer and id=t.id and voucher_status='issued';
 elsif t.source='task_reward' then
 update public.member_daily_vouchers set status='used',resolved_at=now() where organization_id=p_org and customer_id=p_customer and id=t.id and status='issued' and expires_on >= (now() at time zone 'Asia/Taipei')::date;
 else
 update public.member_points_redemptions set status='used',resolved_at=now() where organization_id=p_org and customer_id=p_customer and id=t.id and status='issued';
 end if;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
 end if;
 n:=n+1;
 end loop;
 return n;
end; $function$
;
commit;
