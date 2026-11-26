create table public.checkout_voucher_redemptions (
 organization_id uuid not null, customer_id uuid not null, checkout_app_id text not null, source text not null check(source in ('draw','points')), voucher_id uuid not null, redeemed_at timestamptz not null default now(), primary key(organization_id,source,voucher_id)
);
alter table public.checkout_voucher_redemptions enable row level security;
revoke all on public.checkout_voucher_redemptions from public,anon,authenticated;
grant select,insert on public.checkout_voucher_redemptions to service_role;
create function public.redeem_checkout_vouchers(p_org uuid,p_customer uuid,p_checkout text,p_tickets jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare t record; n integer:=0; existing text; affected integer;
begin
 if p_org is null or p_customer is null or p_checkout is null or length(p_checkout) not between 1 and 120 or jsonb_typeof(p_tickets) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_tickets) not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
 for t in select distinct x.source,x.id from jsonb_to_recordset(p_tickets) as x(source text,id uuid) order by x.source,x.id loop
 if t.source is null or t.source not in ('draw','points') or t.id is null then raise exception 'INVALID_TICKET'; end if;
 insert into public.checkout_voucher_redemptions(organization_id,customer_id,checkout_app_id,source,voucher_id) values(p_org,p_customer,p_checkout,t.source,t.id) on conflict do nothing;
 get diagnostics affected=row_count;
 if affected=0 then
 select checkout_app_id into existing from public.checkout_voucher_redemptions where organization_id=p_org and customer_id=p_customer and source=t.source and voucher_id=t.id;
 if existing is distinct from p_checkout then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
 else
 if t.source='draw' then
 update public.lucky_draw_results set voucher_status='used',voucher_resolved_at=now() where organization_id=p_org and customer_id=p_customer and id=t.id and voucher_status='issued';
 else
 update public.member_points_redemptions set status='used',resolved_at=now() where organization_id=p_org and customer_id=p_customer and id=t.id and status='issued';
 end if;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
 end if;
 n:=n+1;
 end loop;
 return n;
end; $$;
revoke all on function public.redeem_checkout_vouchers(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.redeem_checkout_vouchers(uuid,uuid,text,jsonb) to service_role;
