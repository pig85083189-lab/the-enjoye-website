begin;
create function lucky_draw_private.grant_manual(p_org uuid,p_customer uuid,p_campaign uuid,p_request uuid,p_qty integer,p_actor text,p_reason text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare c public.lucky_draw_campaigns%rowtype; d date:=(now() at time zone 'Asia/Taipei')::date;
begin
 if p_request is null or p_qty is null or p_qty not between 1 and 100 or length(btrim(coalesce(p_reason,''))) not between 1 and 300 or length(btrim(coalesce(p_actor,'')))=0 then raise exception 'INVALID_GRANT'; end if;
 select * into c from public.lucky_draw_campaigns where organization_id=p_org and id=p_campaign for update;
 if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
 if c.status<>'active' or d not between c.starts_on and c.ends_on or c.rules->'manual'->'enabled' is distinct from 'true'::jsonb then raise exception 'GRANT_DISABLED'; end if;
 if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and status::text='ACTIVE') then raise exception 'CUSTOMER_NOT_ELIGIBLE'; end if;
 -- Caller must independently establish current unique LINE identity before invoking.
 return lucky_draw_private.apply_chance_delta(p_org,p_customer,p_campaign,'manual',p_request::text,p_qty,p_actor,btrim(p_reason));
end; $$;
revoke all on function lucky_draw_private.grant_manual(uuid,uuid,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
commit;
