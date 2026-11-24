begin;
create function lucky_draw_private.assert_line_member(p_org uuid,p_customer uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare a text; h text; n integer;
begin
 select app_id into a from public.organizations where id=p_org;
 if a is null then raise exception 'ORG_NOT_FOUND'; end if;
 -- Serialize against identity writes, including newly inserted conflicting links.
 lock table public.member_line_customer_links,public.line_customer_bindings in share mode;
 perform 1 from public.customers where id=p_customer and organization_id=p_org and status::text='ACTIVE' for update;
 if not found then raise exception 'CUSTOMER_NOT_ELIGIBLE'; end if;
 with b as (
 select lower(btrim(line_user_id_hash)) as hash, status, verified, confirmed_at,bound_at,unbound_at,blocked_at
 from public.line_customer_bindings where organization_id=a and customer_uuid=p_customer
 ), candidates as (
 select lower(btrim(line_subject_hash)) as hash from public.member_line_customer_links where organization_id=p_org and customer_id=p_customer and verified_at is not null
 union select hash from b where status='active' and verified and confirmed_at is not null and bound_at is not null and unbound_at is null and blocked_at is null
 ), valid as (
 select hash from candidates c where hash ~ '^[0-9a-f]{64}$' and not exists(
 select 1 from b r where r.hash=c.hash and (r.status='unbound' or r.unbound_at is not null or r.blocked_at is not null)
 and not exists(select 1 from b v where v.hash=r.hash and v.status='active' and v.verified and v.confirmed_at is not null and v.bound_at is not null and v.unbound_at is null and v.blocked_at is null and v.bound_at>greatest(coalesce(r.unbound_at,'-infinity'),coalesce(r.blocked_at,'-infinity')))
 ))
 select count(*),min(hash) into n,h from valid;
 if n<>1 then raise exception 'LINE_NOT_ELIGIBLE'; end if;
 if exists(select 1 from public.member_line_customer_links where organization_id=p_org and lower(btrim(line_subject_hash))=h and customer_id is distinct from p_customer)
 or exists(select 1 from public.line_customer_bindings where organization_id=a and lower(btrim(line_user_id_hash))=h and customer_uuid is distinct from p_customer) then raise exception 'LINE_OWNERSHIP_CONFLICT'; end if;
end; $$;
create function public.lucky_draw_grant_manual(p_org uuid,p_customer uuid,p_campaign uuid,p_request uuid,p_qty integer,p_actor text,p_reason text)
returns bigint language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claims',true)::jsonb->>'role' is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
 perform lucky_draw_private.assert_line_member(p_org,p_customer);
 return lucky_draw_private.grant_manual(p_org,p_customer,p_campaign,p_request,p_qty,p_actor,p_reason);
end; $$;
revoke all on function lucky_draw_private.assert_line_member(uuid,uuid),public.lucky_draw_grant_manual(uuid,uuid,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
commit;