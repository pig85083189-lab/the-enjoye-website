-- Internal lifecycle functions; no API execution grants until staff authorization is integrated.
begin;
create function lucky_draw_private.publish_campaign(p_org uuid,p_name text,p_start date,p_end date,p_rules jsonb,p_prizes jsonb,p_actor text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_version integer; v_total bigint; v_rule text; v_field text;
begin
 if p_start is null or p_end is null or p_end<p_start or p_end<(now() at time zone 'Asia/Taipei')::date then raise exception 'INVALID_DATES'; end if;
 if p_rules is null or jsonb_typeof(p_rules)<>'object' then raise exception 'INVALID_RULES'; end if;
 for v_rule,v_field in select * from (values ('spend','amountMinor'),('points','pointsPerDraw'),('treatment','drawsPerTreatment'),('birthday','drawsPerYear')) as r(a,b) loop
  if jsonb_typeof(p_rules->v_rule->'enabled') is distinct from 'boolean' or jsonb_typeof(p_rules->v_rule->v_field) is distinct from 'number' or coalesce(p_rules->v_rule->>v_field,'') !~ '^[1-9][0-9]{0,8}$' then raise exception 'INVALID_RULES'; end if;
 end loop;
 if jsonb_typeof(p_rules->'manual'->'enabled') is distinct from 'boolean' then raise exception 'INVALID_RULES'; end if;
 if p_prizes is null or jsonb_typeof(p_prizes)<>'array' then raise exception 'INVALID_PRIZES'; end if;
 if jsonb_array_length(p_prizes) not between 1 and 100 then raise exception 'INVALID_PRIZES'; end if;
 select sum(x."oddsBps") into v_total from jsonb_to_recordset(p_prizes) as x("oddsBps" integer);
 if v_total is distinct from 10000 then raise exception 'INVALID_ODDS'; end if;
 perform 1 from public.organizations where id=p_org for update;
 if not found then raise exception 'ORG_NOT_FOUND'; end if;
 if exists(select 1 from public.lucky_draw_campaigns where organization_id=p_org and status in ('active','paused')) then raise exception 'CAMPAIGN_ALREADY_OPEN'; end if;
 select coalesce(max(version),0)+1 into v_version from public.lucky_draw_campaigns where organization_id=p_org;
 insert into public.lucky_draw_campaigns(organization_id,version,name,starts_on,ends_on,rules,status,published_by) values(p_org,v_version,p_name,p_start,p_end,p_rules,'paused',p_actor) returning id into v_id;
 insert into public.lucky_draw_campaign_prizes(organization_id,campaign_id,tier,name,odds_bps,initial_stock,remaining_stock)
 select p_org,v_id,x.tier,x.name,x."oddsBps",x.stock,x.stock from jsonb_to_recordset(p_prizes) as x(tier text,name text,"oddsBps" integer,stock bigint);
 return v_id;
end; $$;
create function lucky_draw_private.transition_campaign(p_org uuid,p_id uuid,p_expected text,p_next text)
returns text language plpgsql security invoker set search_path='' as $$
declare v_status text; v_end date;
begin
 select status,ends_on into v_status,v_end from public.lucky_draw_campaigns where organization_id=p_org and id=p_id for update;
 if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
 if v_status is distinct from p_expected then raise exception 'STATUS_CONFLICT'; end if;
 if not coalesce((v_status='active' and p_next in ('paused','ended')) or (v_status='paused' and p_next in ('active','ended')),false) then raise exception 'INVALID_TRANSITION'; end if;
 if p_next='active' and v_end<(now() at time zone 'Asia/Taipei')::date then raise exception 'CAMPAIGN_EXPIRED'; end if;
 update public.lucky_draw_campaigns set status=p_next where organization_id=p_org and id=p_id;
 return p_next;
end; $$;
revoke all on function lucky_draw_private.publish_campaign(uuid,text,date,date,jsonb,jsonb,text), lucky_draw_private.transition_campaign(uuid,uuid,text,text) from public,anon,authenticated,service_role;
commit;
