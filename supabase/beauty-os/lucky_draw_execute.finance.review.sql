begin;
create function lucky_draw_private.draw_once(p_org uuid,p_customer uuid,p_campaign uuid,p_request uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare c public.lucky_draw_campaigns%rowtype; r public.lucky_draw_results%rowtype; p public.lucky_draw_campaign_prizes%rowtype; ticket integer; cumulative integer:=0; chosen uuid; result_id uuid; d date:=(now() at time zone 'Asia/Taipei')::date;
begin
 if p_request is null then raise exception 'INVALID_REQUEST'; end if;
 perform lucky_draw_private.assert_line_member(p_org,p_customer);
 select * into c from public.lucky_draw_campaigns where organization_id=p_org and id=p_campaign for update;
 if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
 select * into r from public.lucky_draw_results where organization_id=p_org and campaign_id=p_campaign and request_id=p_request;
 if found then
  if r.customer_id<>p_customer then raise exception 'REQUEST_CONFLICT'; end if;
  return r.id;
 end if;
 if c.status<>'active' or d not between c.starts_on and c.ends_on then raise exception 'CAMPAIGN_INACTIVE'; end if;
 if (select coalesce(sum(odds_bps),0) from public.lucky_draw_campaign_prizes where organization_id=p_org and campaign_id=p_campaign)<>10000 then raise exception 'INVALID_ODDS'; end if;
 -- Never silently redistribute advertised odds when a prize sells out.
 if exists(select 1 from public.lucky_draw_campaign_prizes where organization_id=p_org and campaign_id=p_campaign and odds_bps>0 and remaining_stock=0) then raise exception 'PRIZE_STOCK_EXHAUSTED'; end if;
 ticket:=floor(pg_catalog.random()*10000)::integer;
 for p in select * from public.lucky_draw_campaign_prizes where organization_id=p_org and campaign_id=p_campaign order by id for update loop
  cumulative:=cumulative+p.odds_bps;
  if ticket<cumulative then chosen:=p.id; exit; end if;
 end loop;
 if chosen is null then raise exception 'INVALID_ODDS'; end if;
 perform lucky_draw_private.apply_chance_delta(p_org,p_customer,p_campaign,'draw',p_request::text,-1,null,null);
 update public.lucky_draw_campaign_prizes set remaining_stock=remaining_stock-1 where id=chosen and organization_id=p_org and campaign_id=p_campaign and remaining_stock>0;
 if not found then raise exception 'PRIZE_STOCK_EXHAUSTED'; end if;
 insert into public.lucky_draw_results(organization_id,customer_id,campaign_id,request_id,prize_id,prize_name,prize_tier) values(p_org,p_customer,p_campaign,p_request,chosen,p.name,p.tier) returning id into result_id;
 return result_id;
end; $$;
revoke all on function lucky_draw_private.draw_once(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
commit;