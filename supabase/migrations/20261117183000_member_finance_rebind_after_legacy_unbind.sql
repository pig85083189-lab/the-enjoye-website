-- Allow an explicitly re-confirmed, previously revoked LINE identity to reconnect
-- ONLY to its already-verified finance customer, without erasing revocation history.
create or replace function public.confirm_member_finance_line_binding(
 p_code_hash text,p_customer_id uuid,p_actor_auth_user_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v public.member_finance_binding_challenges%rowtype;
 v_org constant uuid := '62bd49b6-a4c3-4da1-b53e-4746923685f1'::uuid;
 v_legacy_count integer;
 v_link_count integer;
begin
 if p_code_hash !~ '^[0-9a-f]{64}$' or p_customer_id is null or p_actor_auth_user_id is null then
   return jsonb_build_object('outcome','INVALID_INPUT');
 end if;
 select * into v from public.member_finance_binding_challenges
 where code_hash=p_code_hash and organization_id=v_org for update;
 if not found or v.status <> 'PENDING' or v.expires_at <= now() then
   return jsonb_build_object('outcome','EXPIRED_OR_INVALID');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||v.line_subject_hash,0));
 if not exists(select 1 from public.customers c where c.id=p_customer_id
    and c.organization_id=v_org and c.status='ACTIVE') then
   return jsonb_build_object('outcome','CUSTOMER_INVALID');
 end if;
 select count(*) into v_legacy_count from public.line_customer_bindings b
   where b.line_user_id_hash=v.line_subject_hash;
 -- A legacy binding must be explicitly revoked; never override a current,
 -- blocked, pending or ambiguous legacy record.
 if exists(select 1 from public.line_customer_bindings b
   where b.line_user_id_hash=v.line_subject_hash
   and (b.unbound_at is null or b.blocked_at is not null
        or b.bound_at is null or b.unbound_at <= b.bound_at)) then
   return jsonb_build_object('outcome','LEGACY_BINDING_REVIEW');
 end if;
 if exists(select 1 from public.line_customer_bindings b
   where b.customer_uuid=p_customer_id and b.line_user_id_hash is distinct from v.line_subject_hash
     and b.unbound_at is null) then
   return jsonb_build_object('outcome','CUSTOMER_BINDING_CONFLICT');
 end if;
 select count(*) into v_link_count from public.member_line_customer_links l
 where l.organization_id=v_org and (l.line_subject_hash=v.line_subject_hash or l.customer_id=p_customer_id);
 if v_link_count>1 or exists(select 1 from public.member_line_customer_links l
   where l.organization_id=v_org and (l.line_subject_hash=v.line_subject_hash or l.customer_id=p_customer_id)
   and (l.line_subject_hash<>v.line_subject_hash or l.customer_id<>p_customer_id)) then
   return jsonb_build_object('outcome','ALREADY_LINKED_OR_CONFLICT');
 end if;
 -- A revoked legacy identity cannot be reassigned to a different customer by this path.
 if v_legacy_count>0 and v_link_count<>1 then
   return jsonb_build_object('outcome','LEGACY_BINDING_REVIEW');
 end if;
 if v_link_count=1 then
   update public.member_line_customer_links set verified_at=now()
    where organization_id=v_org and line_subject_hash=v.line_subject_hash and customer_id=p_customer_id;
 else
   insert into public.member_line_customer_links(organization_id,customer_id,line_subject_hash,verified_at)
   values(v_org,p_customer_id,v.line_subject_hash,now());
 end if;
 update public.member_finance_binding_challenges set status='CONFIRMED',confirmed_at=now(),
   confirmed_customer_id=p_customer_id,confirmed_by_auth_user_id=p_actor_auth_user_id where id=v.id;
 return jsonb_build_object('outcome','LINKED');
exception when unique_violation then
 return jsonb_build_object('outcome','ALREADY_LINKED_OR_CONFLICT');
end $$;
revoke all on function public.confirm_member_finance_line_binding(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_member_finance_line_binding(text,uuid,uuid) to service_role;