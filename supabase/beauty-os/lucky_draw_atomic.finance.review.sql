-- Finance project. Internal primitive, deliberately not executable by API roles.
begin;
create schema if not exists lucky_draw_private;
revoke all on schema lucky_draw_private from public, anon, authenticated, service_role;
create function lucky_draw_private.apply_chance_delta(
 p_org uuid,p_customer uuid,p_campaign uuid,p_source text,p_key text,p_delta integer,p_actor text,p_reason text
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare v_balance bigint; v_existing public.lucky_draw_chance_entries%rowtype;
begin
 if p_delta is null or p_delta=0 or p_source is null or p_source not in ('spend','points','treatment','birthday','manual','draw','reversal') or p_key is null or length(btrim(p_key)) not between 1 and 300 then raise exception 'INVALID_EVENT'; end if;
 if (p_source='draw' and p_delta<>-1) or (p_source='reversal' and p_delta>=0) or (p_source not in ('draw','reversal') and p_delta<=0) then raise exception 'INVALID_DELTA'; end if;
 if p_source='manual' and (coalesce(btrim(p_actor),'')='' or coalesce(btrim(p_reason),'')='') then raise exception 'AUDIT_REQUIRED'; end if;
 if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org) then raise exception 'CUSTOMER_SCOPE_MISMATCH'; end if;
 insert into public.lucky_draw_chance_accounts(organization_id,customer_id,campaign_id) values(p_org,p_customer,p_campaign) on conflict do nothing;
 select balance into strict v_balance from public.lucky_draw_chance_accounts where organization_id=p_org and customer_id=p_customer and campaign_id=p_campaign for update;
 select * into v_existing from public.lucky_draw_chance_entries where organization_id=p_org and campaign_id=p_campaign and source=p_source and source_key=p_key;
 if found then
  if v_existing.customer_id<>p_customer or v_existing.delta<>p_delta or v_existing.actor_id is distinct from p_actor or v_existing.reason is distinct from p_reason then raise exception 'EVENT_CONFLICT'; end if;
  return v_balance;
 end if;
 if v_balance+p_delta<0 then raise exception 'INSUFFICIENT_CHANCES'; end if;
 insert into public.lucky_draw_chance_entries(organization_id,customer_id,campaign_id,source,source_key,delta,actor_id,reason) values(p_org,p_customer,p_campaign,p_source,p_key,p_delta,p_actor,p_reason);
 update public.lucky_draw_chance_accounts set balance=balance+p_delta where organization_id=p_org and customer_id=p_customer and campaign_id=p_campaign returning balance into v_balance;
 return v_balance;
end;
$$;
revoke all on function lucky_draw_private.apply_chance_delta(uuid,uuid,uuid,text,text,integer,text,text) from public, anon, authenticated, service_role;
commit;
