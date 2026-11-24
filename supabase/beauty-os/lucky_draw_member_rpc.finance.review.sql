begin;
create function public.lucky_draw_member_execute(p_org uuid,p_customer uuid,p_campaign uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; answer jsonb;
begin
 if current_setting('request.jwt.claims',true)::jsonb->>'role' is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
 rid:=lucky_draw_private.draw_once(p_org,p_customer,p_campaign,p_request);
 select jsonb_build_object('id',r.id,'tier',r.prize_tier,'name',r.prize_name,'balance',a.balance) into answer
 from public.lucky_draw_results r join public.lucky_draw_chance_accounts a using(organization_id,customer_id,campaign_id)
 where r.id=rid and r.organization_id=p_org and r.customer_id=p_customer and r.campaign_id=p_campaign;
 if answer is null then raise exception 'RESULT_NOT_FOUND'; end if;
 return answer;
end; $$;
revoke all on function public.lucky_draw_member_execute(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
commit;