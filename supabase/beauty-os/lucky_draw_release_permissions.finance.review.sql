begin;
grant execute on function public.lucky_draw_publish(uuid,text,date,date,jsonb,jsonb,text),public.lucky_draw_transition(uuid,uuid,text,text),public.lucky_draw_grant_manual(uuid,uuid,uuid,uuid,integer,text,text),public.lucky_draw_member_execute(uuid,uuid,uuid,uuid) to service_role;
commit;