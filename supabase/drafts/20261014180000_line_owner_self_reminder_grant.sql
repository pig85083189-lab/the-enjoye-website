-- =============================================================================
-- Beauty OS LINE Owner-self reminder grant + oneshot (Phase 2E-9)
-- DRAFT ONLY. DO NOT APPLY to Preview or Production.
-- Do not copy into supabase/migrations/ until Owner confirms.
-- Migration never inserts a grant, oneshot, quota snapshot, or identity row.
-- Never calls LINE. Client-supplied quota parameters are not accepted.
-- Channel lock 870121 + sibling-org FOR UPDATE matches Broadcast claim.
-- PostgreSQL cannot discover the live project ref. Preview identity must be
-- armed later by a trusted server after host + VERCEL_ENV verification.
-- =============================================================================

create table if not exists public.line_owner_self_reminder_grants (
  id text primary key,
  organization_id text not null,
  staff_user_id text not null,
  channel_id text not null,
  purpose text not null,
  appointment_id text not null,
  bind_bound_at timestamptz not null,
  bind_hint text not null,
  bind_key_id text not null,
  acknowledged_once_only boolean not null,
  authorized_via_test_push boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by_staff_id text not null,
  constraint line_owner_self_reminder_grants_id_prefix
    check (id like 'lorg-%'),
  constraint line_owner_self_reminder_grants_test_org
    check (organization_id = 'org-beauty-os-test'),
  constraint line_owner_self_reminder_grants_channel
    check (channel_id = '2009219238'),
  constraint line_owner_self_reminder_grants_purpose
    check (purpose = 'owner_self_reminder_test_once'),
  constraint line_owner_self_reminder_grants_appointment
    check (appointment_id = 'apt-2e7-owner-self'),
  constraint line_owner_self_reminder_grants_hint
    check (bind_hint like '••••%'),
  constraint line_owner_self_reminder_grants_key
    check (bind_key_id = 'line-cred-v1'),
  constraint line_owner_self_reminder_grants_once
    check (acknowledged_once_only = true),
  constraint line_owner_self_reminder_grants_not_test_push
    check (authorized_via_test_push = false),
  constraint line_owner_self_reminder_grants_staff_operational
    check (public.is_operational_staff_id(staff_user_id)),
  constraint line_owner_self_reminder_grants_actor_operational
    check (public.is_operational_staff_id(created_by_staff_id)),
  constraint line_owner_self_reminder_grants_ttl
    check (expires_at > created_at)
);

comment on table public.line_owner_self_reminder_grants is
  'Preview TEST Owner-self one-time reminder consent. Independent of test-push. Draft never inserts a row.';

create unique index if not exists line_owner_self_reminder_grants_one_open
  on public.line_owner_self_reminder_grants (organization_id, staff_user_id)
  where revoked_at is null;

create index if not exists line_owner_self_reminder_grants_bind
  on public.line_owner_self_reminder_grants (organization_id, staff_user_id, bind_bound_at);

create table if not exists public.line_owner_self_reminder_oneshots (
  id text primary key,
  grant_id text not null
    references public.line_owner_self_reminder_grants (id) on delete cascade,
  organization_id text not null,
  staff_user_id text not null,
  channel_id text not null,
  appointment_id text not null,
  bind_bound_at timestamptz not null,
  bind_hint text not null,
  bind_key_id text not null,
  status text not null default 'issued',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  consumed_at timestamptz,
  previous_http_status integer,
  previous_error_class text,
  constraint line_owner_self_reminder_oneshots_id_prefix
    check (id like 'laros-%'),
  constraint line_owner_self_reminder_oneshots_test_org
    check (organization_id = 'org-beauty-os-test'),
  constraint line_owner_self_reminder_oneshots_channel
    check (channel_id = '2009219238'),
  constraint line_owner_self_reminder_oneshots_appointment
    check (appointment_id = 'apt-2e7-owner-self'),
  constraint line_owner_self_reminder_oneshots_hint
    check (bind_hint like '••••%'),
  constraint line_owner_self_reminder_oneshots_key
    check (bind_key_id = 'line-cred-v1'),
  constraint line_owner_self_reminder_oneshots_status
    check (
      status in (
        'issued',
        'claimed',
        'accepted',
        'pending_confirmation',
        'expired',
        'canceled'
      )
    ),
  constraint line_owner_self_reminder_oneshots_ttl
    check (expires_at > created_at)
);

comment on table public.line_owner_self_reminder_oneshots is
  'One-use Owner-self reminder authorization. Timeout/5xx stay pending_confirmation. Draft never inserts a row.';

create unique index if not exists line_owner_self_reminder_oneshots_one_open
  on public.line_owner_self_reminder_oneshots (grant_id)
  where consumed_at is null and status = 'issued';

create unique index if not exists line_owner_self_reminder_oneshots_claimed
  on public.line_owner_self_reminder_oneshots (id)
  where claimed_at is not null;

create table if not exists public.line_owner_self_reminder_quota_snapshots (
  id text primary key,
  channel_id text not null,
  source text not null,
  known boolean not null,
  quota_type text,
  remaining integer,
  checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint line_owner_self_reminder_quota_snapshots_id_prefix
    check (id like 'loqs-%'),
  constraint line_owner_self_reminder_quota_snapshots_channel
    check (channel_id = '2009219238'),
  constraint line_owner_self_reminder_quota_snapshots_source
    check (source = 'service_role'),
  constraint line_owner_self_reminder_quota_snapshots_known
    check (known = true),
  constraint line_owner_self_reminder_quota_snapshots_type
    check (quota_type in ('none', 'limited'))
);

comment on table public.line_owner_self_reminder_quota_snapshots is
  'Trusted LINE quota snapshots written only by service_role. Authenticated callers cannot insert or forge rows. Draft never inserts a row.';

create table if not exists public.line_owner_self_reminder_runtime_identity (
  id text primary key,
  supabase_host text not null,
  runtime text not null,
  armed_at timestamptz not null default now(),
  constraint line_owner_self_reminder_runtime_identity_one
    check (id = 'runtime'),
  constraint line_owner_self_reminder_runtime_identity_preview
    check (
      supabase_host = 'bfzquejrtgqzzarhkiya.supabase.co'
      and runtime = 'preview'
    )
);

comment on table public.line_owner_self_reminder_runtime_identity is
  'Fail-closed Preview identity. Draft never inserts a row. Authenticated cannot write. PostgreSQL cannot discover the live project ref; a service-role arm after server host verification is required.';

alter table public.line_owner_self_reminder_runtime_identity enable row level security;
revoke all on public.line_owner_self_reminder_runtime_identity
  from public, anon, authenticated, service_role;

alter table public.line_owner_self_reminder_grants enable row level security;
alter table public.line_owner_self_reminder_oneshots enable row level security;
alter table public.line_owner_self_reminder_quota_snapshots enable row level security;

revoke all on public.line_owner_self_reminder_grants from public, anon, authenticated;
revoke all on public.line_owner_self_reminder_oneshots from public, anon, authenticated;
revoke all on public.line_owner_self_reminder_quota_snapshots from public, anon, authenticated;
grant select on public.line_owner_self_reminder_grants to authenticated;
grant select on public.line_owner_self_reminder_oneshots to authenticated;

drop policy if exists line_owner_self_reminder_grants_select_owner
  on public.line_owner_self_reminder_grants;
create policy line_owner_self_reminder_grants_select_owner
on public.line_owner_self_reminder_grants
for select
to authenticated
using (
  public.user_is_org_owner(organization_id)
  and organization_id = 'org-beauty-os-test'
);

drop policy if exists line_owner_self_reminder_oneshots_select_owner
  on public.line_owner_self_reminder_oneshots;
create policy line_owner_self_reminder_oneshots_select_owner
on public.line_owner_self_reminder_oneshots
for select
to authenticated
using (
  public.user_is_org_owner(organization_id)
  and organization_id = 'org-beauty-os-test'
);

create or replace function public.line_owner_self_reminder_runtime_is_production()
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select lower(coalesce(pg_catalog.current_setting('app.beauty_os_runtime', true), '')) = 'production';
$$;

comment on function public.line_owner_self_reminder_runtime_is_production() is
  'Extra fail-closed Production detector. A session GUC is not sufficient Preview evidence.';

revoke all on function public.line_owner_self_reminder_runtime_is_production()
  from public, anon;

create or replace function public.line_owner_self_reminder_preview_runtime_ready()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.line_owner_self_reminder_runtime_identity i
    where i.id = 'runtime'
      and i.supabase_host = 'bfzquejrtgqzzarhkiya.supabase.co'
      and i.runtime = 'preview'
  )
  and public.line_owner_self_reminder_runtime_is_production() is not true;
$$;

comment on function public.line_owner_self_reminder_preview_runtime_ready() is
  'True only after a trusted Preview identity row exists. Unset, unknown, Production, or mismatch fail closed. Session GUCs cannot arm this.';

revoke all on function public.line_owner_self_reminder_preview_runtime_ready()
  from public, anon;

create or replace function public.line_owner_self_reminder_environment_block()
returns text
language sql
stable
set search_path = public
as $$
  select case
    when public.line_owner_self_reminder_runtime_is_production() then
      '店長本人測試授權不可在 Production 執行'
    when not public.line_owner_self_reminder_preview_runtime_ready() then
      '店長本人測試授權只允許已確認的 Preview Supabase，未設定或環境不一致時拒絕'
    else null
  end;
$$;

comment on function public.line_owner_self_reminder_environment_block() is
  'Shared fail-closed environment gate. Identity row is required; client SET is not enough.';

revoke all on function public.line_owner_self_reminder_environment_block()
  from public, anon;

create or replace function public.line_owner_self_reminder_service_role_call_allowed(
  p_function text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_oid pg_catalog.regprocedure;
  v_public_execute boolean;
begin
  if p_function is null
     or pg_catalog.strpos(p_function, ';') > 0
     or pg_catalog.strpos(p_function, '--') > 0
     or p_function not in (
       'public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text,text)',
       'public.record_line_owner_self_reminder_quota_snapshot(text,boolean,text,integer,timestamptz)',
       'public.arm_line_owner_self_reminder_preview_runtime(text,text)'
     ) then
    return false;
  end if;

  begin
    v_oid := p_function::pg_catalog.regprocedure;
  exception when others then
    return false;
  end;

  select
    case
      when p.proacl is null then true
      else exists (
        select 1
        from pg_catalog.aclexplode(p.proacl) a
        where a.grantee = 0
          and a.privilege_type = 'EXECUTE'
      )
    end
  into v_public_execute
  from pg_catalog.pg_proc p
  where p.oid = v_oid;
  if coalesce(v_public_execute, true) then
    return false;
  end if;

  if coalesce(pg_catalog.has_function_privilege('anon', p_function, 'execute'), true)
     or coalesce(pg_catalog.has_function_privilege('authenticated', p_function, 'execute'), true) then
    return false;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator')
     and coalesce(
       pg_catalog.has_function_privilege('authenticator', p_function, 'execute'),
       false
     ) then
    return false;
  end if;
  if not coalesce(
    pg_catalog.has_function_privilege('service_role', p_function, 'execute'),
    false
  ) then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.line_owner_self_reminder_service_role_call_allowed(text) is
  'GRANT-lock for Owner-self privileged RPCs. Does not trust JWT, session_user, or client quota.';

revoke all on function public.line_owner_self_reminder_service_role_call_allowed(text)
  from public, anon, authenticated, service_role;

create or replace function public.grant_line_owner_self_reminder_test(
  p_organization_id text,
  p_acknowledged_once_only boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.staff_auth_memberships%rowtype;
  v_lock_org text;
  v_recipient public.line_owner_recipients%rowtype;
  v_secret public.line_owner_recipient_secrets%rowtype;
  v_grant public.line_owner_self_reminder_grants%rowtype;
  v_id text;
begin
  if public.line_owner_self_reminder_environment_block() is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'send_closed',
      'message', public.line_owner_self_reminder_environment_block()
    );
  end if;
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_organization_id is distinct from 'org-beauty-os-test' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'unauthorized',
      'message', '店長本人測試同意只允許 Beauty OS TEST'
    );
  end if;
  if coalesce(p_acknowledged_once_only, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'reason', 'not_consented',
      'message', '必須主動同意這是只限一次的預約提醒測試'
    );
  end if;

  select a.organization_id
    into v_lock_org
  from public.line_official_accounts a
  where a.organization_id = p_organization_id
    and a.channel_id = '2009219238'
  for update;
  if not found then
    return jsonb_build_object(
      'ok', false,
      'reason', 'unbound',
      'message', '尚未設定 THE ENJOYE LINE Channel'
    );
  end if;

  select * into v_actor
  from public.staff_auth_memberships
  where auth_user_id = v_uid
    and organization_id = p_organization_id
    and is_active = true
    and role = 'OWNER'
  limit 1;
  if not found then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_recipient
  from public.line_owner_recipients
  where organization_id = p_organization_id
  for update;
  if not found
     or v_recipient.bind_method is distinct from 'webhook_code'
     or v_recipient.staff_user_id is distinct from v_actor.user_id
     or v_recipient.line_user_id_hint not like '••••%' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'unbound',
      'message', '必須使用官方 Webhook 驗證的店長本人綁定'
    );
  end if;

  select * into v_secret
  from public.line_owner_recipient_secrets
  where organization_id = p_organization_id
  for update;
  if not found or v_secret.key_id is distinct from 'line-cred-v1' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'unbound',
      'message', '店長 LINE 綁定不是可解密的正式憑證'
    );
  end if;

  update public.line_owner_self_reminder_grants
  set revoked_at = now()
  where organization_id = p_organization_id
    and staff_user_id = v_actor.user_id
    and revoked_at is null;

  v_id := 'lorg-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.line_owner_self_reminder_grants (
    id,
    organization_id,
    staff_user_id,
    channel_id,
    purpose,
    appointment_id,
    bind_bound_at,
    bind_hint,
    bind_key_id,
    acknowledged_once_only,
    authorized_via_test_push,
    created_at,
    expires_at,
    created_by_staff_id
  ) values (
    v_id,
    p_organization_id,
    v_actor.user_id,
    '2009219238',
    'owner_self_reminder_test_once',
    'apt-2e7-owner-self',
    v_recipient.bound_at,
    v_recipient.line_user_id_hint,
    v_secret.key_id,
    true,
    false,
    now(),
    now() + interval '24 hours',
    v_actor.user_id
  )
  returning * into v_grant;

  return jsonb_build_object(
    'ok', true,
    'grant_id', v_grant.id,
    'expires_at', v_grant.expires_at,
    'purpose', v_grant.purpose,
    'staff_user_id', v_grant.staff_user_id,
    'authorized_via_test_push', false
  );
end;
$$;

comment on function public.grant_line_owner_self_reminder_test(text, boolean) is
  'Authenticated Owner Preview TEST self-consent. Actor staff id is taken from membership, not client. Ignores test-push. 24h TTL. Does not call LINE.';

revoke all on function public.grant_line_owner_self_reminder_test(text, boolean)
  from public, anon, service_role;
grant execute on function public.grant_line_owner_self_reminder_test(text, boolean)
  to authenticated;

create or replace function public.revoke_line_owner_self_reminder_test(
  p_organization_id text,
  p_grant_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.staff_auth_memberships%rowtype;
  v_grant public.line_owner_self_reminder_grants%rowtype;
begin
  if public.line_owner_self_reminder_environment_block() is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'send_closed',
      'message', public.line_owner_self_reminder_environment_block()
    );
  end if;
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_organization_id is distinct from 'org-beauty-os-test' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'unauthorized',
      'message', '店長本人測試同意只允許 Beauty OS TEST'
    );
  end if;
  if p_grant_id is null or p_grant_id not like 'lorg-%' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input', 'message', '缺少同意識別');
  end if;

  select * into v_actor
  from public.staff_auth_memberships
  where auth_user_id = v_uid
    and organization_id = p_organization_id
    and is_active = true
    and role = 'OWNER'
  limit 1;
  if not found then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_grant
  from public.line_owner_self_reminder_grants
  where id = p_grant_id
    and organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_consented', 'message', '找不到店長本人測試同意');
  end if;
  if v_grant.staff_user_id is distinct from v_actor.user_id then
    return jsonb_build_object(
      'ok', false,
      'reason', 'unauthorized',
      'message', '非本人不能撤回這次店長本人測試同意'
    );
  end if;

  update public.line_owner_self_reminder_grants
  set revoked_at = coalesce(revoked_at, now())
  where id = v_grant.id;

  update public.line_owner_self_reminder_oneshots
  set status = case when status = 'issued' then 'canceled' else status end
  where grant_id = v_grant.id
    and consumed_at is null
    and status = 'issued';

  return jsonb_build_object('ok', true, 'grant_id', v_grant.id, 'revoked', true);
end;
$$;

comment on function public.revoke_line_owner_self_reminder_test(text, text) is
  'Owner may revoke only their own Preview TEST self-consent. Issued oneshots are canceled. Does not call LINE.';

revoke all on function public.revoke_line_owner_self_reminder_test(text, text)
  from public, anon, service_role;
grant execute on function public.revoke_line_owner_self_reminder_test(text, text)
  to authenticated;

create or replace function public.issue_line_owner_self_reminder_oneshot(
  p_organization_id text,
  p_grant_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.staff_auth_memberships%rowtype;
  v_grant public.line_owner_self_reminder_grants%rowtype;
  v_recipient public.line_owner_recipients%rowtype;
  v_secret public.line_owner_recipient_secrets%rowtype;
  v_id text;
begin
  if public.line_owner_self_reminder_environment_block() is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'send_closed',
      'message', public.line_owner_self_reminder_environment_block()
    );
  end if;
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_organization_id is distinct from 'org-beauty-os-test' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'unauthorized',
      'message', '店長本人測試同意只允許 Beauty OS TEST'
    );
  end if;

  select * into v_actor
  from public.staff_auth_memberships
  where auth_user_id = v_uid
    and organization_id = p_organization_id
    and is_active = true
    and role = 'OWNER'
  limit 1;
  if not found then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_grant
  from public.line_owner_self_reminder_grants
  where id = p_grant_id
    and organization_id = p_organization_id
  for update;
  if not found
     or v_grant.revoked_at is not null
     or v_grant.expires_at <= now()
     or v_grant.staff_user_id is distinct from v_actor.user_id
     or v_grant.authorized_via_test_push
     or v_grant.purpose is distinct from 'owner_self_reminder_test_once'
     or v_grant.appointment_id is distinct from 'apt-2e7-owner-self'
     or v_grant.channel_id is distinct from '2009219238'
     or v_grant.acknowledged_once_only is not true then
    return jsonb_build_object(
      'ok', false,
      'reason', 'not_consented',
      'message', '沒有有效、未撤回的店長本人測試同意'
    );
  end if;

  select * into v_recipient
  from public.line_owner_recipients
  where organization_id = p_organization_id;
  select * into v_secret
  from public.line_owner_recipient_secrets
  where organization_id = p_organization_id;
  if not found
     or v_recipient.bound_at is distinct from v_grant.bind_bound_at
     or v_recipient.line_user_id_hint is distinct from v_grant.bind_hint
     or v_recipient.staff_user_id is distinct from v_grant.staff_user_id
     or v_secret.key_id is distinct from v_grant.bind_key_id then
    return jsonb_build_object(
      'ok', false,
      'reason', 'not_consented',
      'message', '重新綁定後舊的測試同意已失效'
    );
  end if;

  v_id := 'laros-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  insert into public.line_owner_self_reminder_oneshots (
    id,
    grant_id,
    organization_id,
    staff_user_id,
    channel_id,
    appointment_id,
    bind_bound_at,
    bind_hint,
    bind_key_id,
    status,
    created_at,
    expires_at
  ) values (
    v_id,
    v_grant.id,
    v_grant.organization_id,
    v_grant.staff_user_id,
    v_grant.channel_id,
    v_grant.appointment_id,
    v_grant.bind_bound_at,
    v_grant.bind_hint,
    v_grant.bind_key_id,
    'issued',
    now(),
    now() + interval '2 hours'
  );

  return jsonb_build_object('ok', true, 'oneshot_id', v_id, 'grant_id', v_grant.id);
end;
$$;

comment on function public.issue_line_owner_self_reminder_oneshot(text, text) is
  'Issues one unused laros- oneshot for the current Owner''s valid grant. 2h TTL. Does not call LINE.';

revoke all on function public.issue_line_owner_self_reminder_oneshot(text, text)
  from public, anon, service_role;
grant execute on function public.issue_line_owner_self_reminder_oneshot(text, text)
  to authenticated;

create or replace function public.record_line_owner_self_reminder_quota_snapshot(
  p_channel_id text,
  p_quota_known boolean,
  p_quota_type text,
  p_quota_remaining integer,
  p_quota_checked_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  if not public.line_owner_self_reminder_service_role_call_allowed(
    'public.record_line_owner_self_reminder_quota_snapshot(text,boolean,text,integer,timestamptz)'
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if public.line_owner_self_reminder_environment_block() is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'send_closed',
      'message', public.line_owner_self_reminder_environment_block()
    );
  end if;
  if p_channel_id is distinct from '2009219238'
     or coalesce(p_quota_known, false) is not true
     or p_quota_type not in ('none', 'limited')
     or p_quota_checked_at is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'quota_exceeded',
      'message', 'LINE 額度未知時拒絕發送'
    );
  end if;
  if p_quota_type = 'limited'
     and (p_quota_remaining is null or p_quota_remaining < 1) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'quota_exceeded',
      'message', 'LINE 官方額度不足'
    );
  end if;

  v_id := 'loqs-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.line_owner_self_reminder_quota_snapshots (
    id, channel_id, source, known, quota_type, remaining, checked_at
  ) values (
    v_id, p_channel_id, 'service_role', true, p_quota_type, p_quota_remaining, p_quota_checked_at
  );

  return jsonb_build_object('ok', true, 'snapshot_id', v_id, 'source', 'service_role');
end;
$$;

comment on function public.record_line_owner_self_reminder_quota_snapshot(text, boolean, text, integer, timestamptz) is
  'service_role-only trusted quota snapshot writer. Authenticated cannot forge known=true. This draft never calls LINE.';

revoke all on function public.record_line_owner_self_reminder_quota_snapshot(text, boolean, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_line_owner_self_reminder_quota_snapshot(text, boolean, text, integer, timestamptz)
  to service_role;

create or replace function public.arm_line_owner_self_reminder_preview_runtime(
  p_supabase_host text,
  p_runtime text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.line_owner_self_reminder_service_role_call_allowed(
    'public.arm_line_owner_self_reminder_preview_runtime(text,text)'
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if public.line_owner_self_reminder_runtime_is_production() then
    return jsonb_build_object(
      'ok', false,
      'reason', 'send_closed',
      'message', '店長本人測試授權不可在 Production 執行'
    );
  end if;
  if p_supabase_host is distinct from 'bfzquejrtgqzzarhkiya.supabase.co'
     or p_runtime is distinct from 'preview' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'send_closed',
      'message', '店長本人測試授權只允許已確認的 Preview Supabase，未設定或環境不一致時拒絕'
    );
  end if;

  insert into public.line_owner_self_reminder_runtime_identity (
    id, supabase_host, runtime, armed_at
  ) values (
    'runtime', p_supabase_host, p_runtime, now()
  )
  on conflict (id) do update
    set supabase_host = excluded.supabase_host,
        runtime = excluded.runtime,
        armed_at = now();

  return jsonb_build_object(
    'ok', true,
    'supabase_host', p_supabase_host,
    'runtime', p_runtime
  );
end;
$$;

comment on function public.arm_line_owner_self_reminder_preview_runtime(text, text) is
  'service_role-only Preview identity arm. Does not trust client GUCs. Server must verify NEXT_PUBLIC_SUPABASE_URL before calling. Draft never calls this.';

revoke all on function public.arm_line_owner_self_reminder_preview_runtime(text, text)
  from public, anon, authenticated;
grant execute on function public.arm_line_owner_self_reminder_preview_runtime(text, text)
  to service_role;

drop function if exists public.claim_line_owner_self_reminder_oneshot(text, text, text, text, text, boolean, integer, timestamptz);

create or replace function public.claim_line_owner_self_reminder_oneshot(
  p_organization_id text,
  p_oneshot_id text,
  p_grant_id text,
  p_appointment_id text,
  p_confirm_phrase text,
  p_actor_staff_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.staff_auth_memberships%rowtype;
  v_lock_org text;
  v_channel_before text;
  v_channel_id text;
  v_grant public.line_owner_self_reminder_grants%rowtype;
  v_oneshot public.line_owner_self_reminder_oneshots%rowtype;
  v_recipient public.line_owner_recipients%rowtype;
  v_secret public.line_owner_recipient_secrets%rowtype;
  v_snapshot public.line_owner_self_reminder_quota_snapshots%rowtype;
  v_used_today integer := 0;
begin
  if not public.line_owner_self_reminder_service_role_call_allowed(
    'public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text,text)'
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if public.line_owner_self_reminder_environment_block() is not null then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'message', public.line_owner_self_reminder_environment_block()
    );
  end if;
  if p_organization_id is distinct from 'org-beauty-os-test' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'unauthorized',
      'message', '店長本人測試發送只允許 Beauty OS TEST'
    );
  end if;
  if p_oneshot_id is null or p_oneshot_id not like 'laros-%' then
    return jsonb_build_object('claimed', false, 'reason', 'invalid_input', 'message', '缺少單次授權識別');
  end if;
  if p_appointment_id is distinct from 'apt-2e7-owner-self' then
    return jsonb_build_object('claimed', false, 'reason', 'invalid_input', 'message', '只能授權固定的一筆測試預約');
  end if;
  if btrim(coalesce(p_confirm_phrase, '')) is distinct from '確認發送一則給我自己的預約提醒測試' then
    return jsonb_build_object('claimed', false, 'reason', 'invalid_input', 'message', '請再次確認這次只發給店長本人');
  end if;
  if p_actor_staff_user_id is null or not public.is_operational_staff_id(p_actor_staff_user_id) then
    return jsonb_build_object('claimed', false, 'reason', 'unauthorized', 'message', '缺少店長本人識別');
  end if;

  select * into v_actor
  from public.staff_auth_memberships
  where organization_id = p_organization_id
    and user_id = p_actor_staff_user_id
    and is_active = true
    and role = 'OWNER'
  limit 1;
  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'unauthorized',
      'message', '綁定必須屬於目前登入的店長本人'
    );
  end if;

  select a.channel_id
    into v_channel_before
  from public.line_official_accounts a
  where a.organization_id = p_organization_id;
  if not found or v_channel_before is distinct from '2009219238' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'unauthorized',
      'message', '只能沿用現有 THE ENJOYE LINE Channel'
    );
  end if;

  -- Same Channel send lock as claim_line_broadcast_send: namespace 870121
  -- then FOR UPDATE every Organization on that Channel, ordered by org id.
  perform pg_advisory_xact_lock(870121, hashtext(v_channel_before));

  for v_lock_org in
    select a.organization_id
    from public.line_official_accounts a
    where a.organization_id = p_organization_id
       or a.channel_id = v_channel_before
    order by a.organization_id
    for update
  loop
    null;
  end loop;

  select a.channel_id
    into v_channel_id
  from public.line_official_accounts a
  where a.organization_id = p_organization_id;
  if v_channel_id is distinct from v_channel_before then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'message', 'LINE Channel 已變更，已停止發送'
    );
  end if;

  if public.line_broadcast_channel_has_inflight(v_channel_id) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'inflight',
      'message', '同一 LINE Channel 尚有發送進行中，已停止以免超額'
    );
  end if;

  select * into v_snapshot
  from public.line_owner_self_reminder_quota_snapshots s
  where s.channel_id = v_channel_id
    and s.source = 'service_role'
    and s.known = true
  order by s.checked_at desc
  limit 1
  for update;
  if not found
     or v_snapshot.checked_at < now() - interval '30 seconds'
     or v_snapshot.checked_at > now() + interval '5 seconds'
     or (v_snapshot.quota_type = 'limited' and coalesce(v_snapshot.remaining, 0) < 1) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'quota_exceeded',
      'message', 'LINE 額度未知時拒絕發送'
    );
  end if;

  select * into v_grant
  from public.line_owner_self_reminder_grants
  where id = p_grant_id
    and organization_id = p_organization_id
  for update;
  if not found
     or v_grant.revoked_at is not null
     or v_grant.expires_at <= now()
     or v_grant.staff_user_id is distinct from v_actor.user_id
     or v_grant.staff_user_id is distinct from p_actor_staff_user_id
     or v_grant.authorized_via_test_push
     or v_grant.purpose is distinct from 'owner_self_reminder_test_once'
     or v_grant.appointment_id is distinct from 'apt-2e7-owner-self'
     or v_grant.channel_id is distinct from v_channel_id
     or v_grant.acknowledged_once_only is not true then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'not_consented',
      'message', '沒有有效、未撤回的店長本人測試同意'
    );
  end if;

  select * into v_oneshot
  from public.line_owner_self_reminder_oneshots
  where id = p_oneshot_id
    and grant_id = v_grant.id
    and organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'invalid_input', 'message', '找不到單次授權');
  end if;
  if v_oneshot.organization_id is distinct from v_grant.organization_id
     or v_oneshot.staff_user_id is distinct from v_grant.staff_user_id
     or v_oneshot.channel_id is distinct from v_grant.channel_id
     or v_oneshot.appointment_id is distinct from v_grant.appointment_id
     or v_oneshot.appointment_id is distinct from 'apt-2e7-owner-self'
     or v_oneshot.bind_bound_at is distinct from v_grant.bind_bound_at
     or v_oneshot.bind_hint is distinct from v_grant.bind_hint
     or v_oneshot.bind_key_id is distinct from v_grant.bind_key_id then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'duplicate',
      'message', '單次授權不能在更改收件者後重用'
    );
  end if;
  if v_oneshot.consumed_at is not null
     or v_oneshot.claimed_at is not null
     or v_oneshot.status in ('claimed', 'accepted', 'pending_confirmation', 'canceled') then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'duplicate',
      'message', '這次單次授權已使用或結果待確認，不會重送'
    );
  end if;
  if v_oneshot.previous_error_class in ('timeout', 'unknown')
     or v_oneshot.previous_http_status in (500, 502, 503, 504) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'duplicate',
      'message', '這次單次授權已使用或結果待確認，不會重送'
    );
  end if;
  if v_oneshot.expires_at <= now() or v_oneshot.status = 'expired' then
    return jsonb_build_object('claimed', false, 'reason', 'duplicate', 'message', '單次授權已過期，不會重送');
  end if;

  select * into v_recipient
  from public.line_owner_recipients
  where organization_id = p_organization_id;
  select * into v_secret
  from public.line_owner_recipient_secrets
  where organization_id = p_organization_id;
  if not found
     or v_recipient.bound_at is distinct from v_oneshot.bind_bound_at
     or v_recipient.line_user_id_hint is distinct from v_oneshot.bind_hint
     or v_recipient.staff_user_id is distinct from v_oneshot.staff_user_id
     or v_secret.key_id is distinct from v_oneshot.bind_key_id then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'duplicate',
      'message', '單次授權不能在更改收件者後重用'
    );
  end if;

  select count(*)::integer
    into v_used_today
  from public.line_owner_self_reminder_oneshots s
  where s.organization_id = p_organization_id
    and s.status in ('claimed', 'accepted', 'pending_confirmation')
    and (coalesce(s.claimed_at, s.created_at) at time zone 'Asia/Taipei')::date
      = (timezone('Asia/Taipei', now()))::date;
  if v_used_today >= 1 then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'quota_exceeded',
      'message', '今日店長本人測試發送次數已達上限'
    );
  end if;

  update public.line_owner_self_reminder_oneshots
  set status = 'claimed',
      claimed_at = now()
  where id = v_oneshot.id
    and status = 'issued'
    and claimed_at is null
    and consumed_at is null;
  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'duplicate',
      'message', '這次單次授權已使用或結果待確認，不會重送'
    );
  end if;

  return jsonb_build_object(
    'claimed', true,
    'would_send', false,
    'sent', false,
    'oneshot_id', v_oneshot.id,
    'grant_id', v_grant.id,
    'status', 'claimed'
  );
end;
$$;

comment on function public.claim_line_owner_self_reminder_oneshot(text, text, text, text, text, text) is
  'service_role-only Owner-self oneshot claim. Reads trusted quota snapshots only. Same Channel lock as Broadcast. Does not accept client quota. Does not call LINE.';

revoke all on function public.claim_line_owner_self_reminder_oneshot(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_line_owner_self_reminder_oneshot(text, text, text, text, text, text)
  to service_role;
