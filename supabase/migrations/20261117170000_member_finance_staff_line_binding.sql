-- Finance-only, two-party LINE customer binding. No booking DB writes.
create table if not exists public.member_finance_binding_challenges (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 line_subject_hash text not null check (line_subject_hash ~ '^[0-9a-f]{64}$'),
 code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
 status text not null default 'PENDING' check (status in ('PENDING','CONFIRMED','EXPIRED')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 confirmed_at timestamptz,
 confirmed_customer_id uuid references public.customers(id),
 confirmed_by_auth_user_id uuid
);
create index if not exists member_finance_binding_challenges_subject_idx
 on public.member_finance_binding_challenges(organization_id,line_subject_hash,created_at desc);
alter table public.member_finance_binding_challenges enable row level security;
revoke all on public.member_finance_binding_challenges from public,anon,authenticated;
grant select,insert,update on public.member_finance_binding_challenges to service_role;

create or replace function public.confirm_member_finance_line_binding(
 p_code_hash text, p_customer_id uuid, p_actor_auth_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare
 v public.member_finance_binding_challenges%rowtype;
 v_org constant uuid := '62bd49b6-a4c3-4da1-b53e-4746923685f1'::uuid;
 v_existing uuid;
begin
 if p_code_hash !~ '^[0-9a-f]{64}$' or p_customer_id is null or p_actor_auth_user_id is null then
   return jsonb_build_object('outcome','INVALID_INPUT');
 end if;
 select * into v from public.member_finance_binding_challenges
 where code_hash=p_code_hash and organization_id=v_org for update;
 if not found or v.status <> 'PENDING' or v.expires_at <= now() then
   return jsonb_build_object('outcome','EXPIRED_OR_INVALID');
 end if;
 -- Serialize all claims of the same LINE identity.
 perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||v.line_subject_hash,0));
 if not exists(select 1 from public.customers c
   where c.id=p_customer_id and c.organization_id=v_org and c.status='ACTIVE') then
   return jsonb_build_object('outcome','CUSTOMER_INVALID');
 end if;
 -- Never override a legacy binding, including revoked or pending records.
 if exists(select 1 from public.line_customer_bindings b
   where b.line_user_id_hash=v.line_subject_hash or b.customer_uuid=p_customer_id) then
   return jsonb_build_object('outcome','LEGACY_BINDING_REVIEW');
 end if;
 if exists(select 1 from public.member_line_customer_links l
   where l.organization_id=v_org and
     (l.line_subject_hash=v.line_subject_hash or l.customer_id=p_customer_id)) then
   return jsonb_build_object('outcome','ALREADY_LINKED_OR_CONFLICT');
 end if;
 insert into public.member_line_customer_links
   (organization_id,customer_id,line_subject_hash,verified_at)
 values(v_org,p_customer_id,v.line_subject_hash,now());
 update public.member_finance_binding_challenges
 set status='CONFIRMED',confirmed_at=now(),confirmed_customer_id=p_customer_id,
     confirmed_by_auth_user_id=p_actor_auth_user_id
 where id=v.id;
 return jsonb_build_object('outcome','LINKED');
exception when unique_violation then
 return jsonb_build_object('outcome','ALREADY_LINKED_OR_CONFLICT');
end $$;
revoke all on function public.confirm_member_finance_line_binding(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_member_finance_line_binding(text,uuid,uuid) to service_role;
