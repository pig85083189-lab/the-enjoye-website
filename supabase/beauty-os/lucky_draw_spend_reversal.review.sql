-- Review only. Caller must verify authoritative void/refund before invoking.
begin;
create or replace function public.lucky_draw_reverse_spend(p_org uuid,p_campaign uuid,p_source_key text)
returns text language plpgsql security definer set search_path='' as $$
declare e public.lucky_draw_chance_entries%rowtype; b bigint;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_source_key is null or p_source_key !~ '^(booking|finance):[0-9a-fA-F-]{36}$' then raise exception 'INVALID_KEY'; end if;
 perform 1 from public.lucky_draw_campaigns where organization_id=p_org and id=p_campaign for update;
 if not found then return 'NOT_FOUND'; end if;
 select * into e from public.lucky_draw_chance_entries where organization_id=p_org and campaign_id=p_campaign and source='spend' and source_key=p_source_key;
 if not found then return 'NOT_GRANTED'; end if;
 select balance into strict b from public.lucky_draw_chance_accounts where organization_id=p_org and campaign_id=p_campaign and customer_id=e.customer_id for update;
 if exists(select 1 from public.lucky_draw_chance_entries where organization_id=p_org and campaign_id=p_campaign and source='reversal' and source_key='void:'||p_source_key) then return 'ALREADY_REVERSED'; end if;
 if b<e.delta then return 'REVIEW_INSUFFICIENT_BALANCE'; end if;
 perform lucky_draw_private.apply_chance_delta(p_org,e.customer_id,p_campaign,'reversal','void:'||p_source_key,-e.delta,null,'transaction_void');
 return 'REVERSED';
end; $$;
revoke all on function public.lucky_draw_reverse_spend(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.lucky_draw_reverse_spend(uuid,uuid,text) to service_role;
commit;
