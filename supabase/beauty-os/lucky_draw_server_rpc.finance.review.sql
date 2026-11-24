begin;
-- Narrow server-only wrappers. No direct table privileges granted.
create function public.lucky_draw_publish(p_org uuid,p_name text,p_start date,p_end date,p_rules jsonb,p_prizes jsonb,p_actor text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claims',true)::jsonb->>'role' is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
 return lucky_draw_private.publish_campaign(p_org,p_name,p_start,p_end,p_rules,p_prizes,p_actor);
end; $$;
create function public.lucky_draw_transition(p_org uuid,p_id uuid,p_expected text,p_next text)
returns text language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claims',true)::jsonb->>'role' is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
 return lucky_draw_private.transition_campaign(p_org,p_id,p_expected,p_next);
end; $$;
revoke all on function public.lucky_draw_publish(uuid,text,date,date,jsonb,jsonb,text),public.lucky_draw_transition(uuid,uuid,text,text) from public,anon,authenticated,service_role;
-- Enable only after API and build review.
commit;
