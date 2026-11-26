alter table public.lucky_draw_results add column voucher_status text not null default 'issued' check(voucher_status in ('issued','used','cancelled')), add column voucher_resolved_at timestamptz;
alter table public.lucky_draw_campaign_prizes add column ticket_color text not null default 'gold' check(ticket_color in ('gold','rose','sage','lavender')), add column ticket_icon text not null default 'gift' check(ticket_icon in ('gift','aroma','facial','lotus')), add column ticket_image_url text;
create function public.resolve_lucky_draw_voucher(p_org uuid,p_result uuid,p_action text) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 if p_action not in ('used','cancelled') or p_action is null then raise exception 'INVALID_ACTION'; end if;
 update public.lucky_draw_results set voucher_status=p_action,voucher_resolved_at=now() where organization_id=p_org and id=p_result and voucher_status='issued' returning id into v_id;
 if v_id is null then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
 return v_id;
end; $$;
revoke all on function public.resolve_lucky_draw_voucher(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_lucky_draw_voucher(uuid,uuid,text) to service_role;
