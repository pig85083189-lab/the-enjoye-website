-- Formal LINE customer bindings for Phase 2B recipient verification.
-- 8-digit codes only prove the LINE account holder obtained the code.
-- Trusted recipient requires owner in-person identity confirmation.
-- Consume requires a Channel-Secret-derived server proof, not only the
-- public webhook URL token. Does not send LINE, open Cron, or rewrite
-- Broadcast. Do not apply on Production until Owner confirms.

create table if not exists public.line_customer_bindings (
  id text primary key,
  organization_id text not null,
  customer_id text not null,
  customer_uuid uuid,
  line_user_id_hint text not null,
  line_user_id_hash text not null,
  bind_method text not null default 'webhook_code',
  verified boolean not null default false,
  status text not null default 'pending',
  captured_at timestamptz,
  bound_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by text,
  unbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_customer_bindings_id_prefix
    check (id like 'lcb-%'),
  constraint line_customer_bindings_org_prefix
    check (organization_id like 'org-%'),
  constraint line_customer_bindings_method_check
    check (bind_method = 'webhook_code'),
  constraint line_customer_bindings_hint_mask
    check (line_user_id_hint like '••••%'),
  constraint line_customer_bindings_hash_sha256
    check (line_user_id_hash ~ '^[0-9a-f]{64}$'),
  constraint line_customer_bindings_status_check
    check (status in ('pending', 'active', 'unbound')),
  constraint line_customer_bindings_confirmed_by_operational
    check (confirmed_by is null or public.is_operational_staff_id(confirmed_by)),
  constraint line_customer_bindings_verified_active
    check (
      (
        verified is true
        and status = 'active'
        and bound_at is not null
        and confirmed_at is not null
        and confirmed_by is not null
      )
      or (verified is not true)
    )
);

comment on table public.line_customer_bindings is
  'Customer LINE binding metadata. Ciphertext lives in secrets. Pending capture is not a trusted SPA identity. Never stores plaintext LINE user id.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'line_customer_bindings_org_customer_key'
      and conrelid = 'public.line_customer_bindings'::regclass
  ) then
    alter table public.line_customer_bindings
      add constraint line_customer_bindings_org_customer_key
      unique (organization_id, customer_id);
  end if;
end;
$$;

create unique index if not exists line_customer_bindings_active_hash_key
  on public.line_customer_bindings (line_user_id_hash)
  where status = 'active' and verified is true;

create index if not exists line_customer_bindings_org_status_idx
  on public.line_customer_bindings (organization_id, status, customer_id);

create table if not exists public.line_customer_binding_secrets (
  binding_id text primary key
    references public.line_customer_bindings (id) on delete cascade,
  organization_id text not null,
  line_user_id_cipher text not null,
  key_id text not null,
  updated_at timestamptz not null default now(),
  constraint line_customer_binding_secrets_org_prefix
    check (organization_id like 'org-%'),
  constraint line_customer_binding_secrets_cipher_prefix
    check (line_user_id_cipher like 'v1.%')
);

comment on table public.line_customer_binding_secrets is
  'Encrypted LINE user id for a captured or verified customer binding. No authenticated or anon grants.';

create table if not exists public.line_customer_bind_challenges (
  id text primary key,
  organization_id text not null,
  customer_id text not null,
  customer_uuid uuid,
  staff_user_id text not null,
  code_hash text not null,
  identity_confirmed_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_event_id text,
  consumed_proof_hash text,
  failed_attempts integer not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  constraint line_customer_bind_challenges_id_prefix
    check (id like 'lcbc-%'),
  constraint line_customer_bind_challenges_org_prefix
    check (organization_id like 'org-%'),
  constraint line_customer_bind_challenges_staff_operational
    check (public.is_operational_staff_id(staff_user_id)),
  constraint line_customer_bind_challenges_attempts_nonneg
    check (failed_attempts >= 0)
);

comment on table public.line_customer_bind_challenges is
  'One-time customer bind codes after owner in-person identity confirmation. Plaintext code is returned once.';

create unique index if not exists line_customer_bind_challenges_one_open
  on public.line_customer_bind_challenges (organization_id, customer_id)
  where consumed_at is null;

create table if not exists public.line_customer_bind_challenge_secrets (
  challenge_id text primary key
    references public.line_customer_bind_challenges (id) on delete cascade,
  organization_id text not null,
  hmac_key text not null,
  created_at timestamptz not null default now(),
  constraint line_customer_bind_challenge_secrets_org_prefix
    check (organization_id like 'org-%'),
  constraint line_customer_bind_challenge_secrets_hmac_sha256
    check (hmac_key ~ '^[0-9a-f]{64}$')
);

comment on table public.line_customer_bind_challenge_secrets is
  'Server-only HMAC key derived from Channel Secret. No authenticated or anon grants.';

alter table public.line_customer_bindings enable row level security;
alter table public.line_customer_binding_secrets enable row level security;
alter table public.line_customer_bind_challenges enable row level security;
alter table public.line_customer_bind_challenge_secrets enable row level security;

revoke all on public.line_customer_bindings from anon, authenticated, public;
revoke all on public.line_customer_binding_secrets from anon, authenticated, public;
revoke all on public.line_customer_bind_challenges from anon, authenticated, public;
revoke all on public.line_customer_bind_challenge_secrets from anon, authenticated, public;

drop policy if exists line_customer_bindings_select_owner
  on public.line_customer_bindings;

create or replace function public.line_customer_binding_resolve(
  p_organization_id text,
  p_customer_id text
)
returns table(customer_id text, customer_uuid uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return;
  end if;
  if p_customer_id is null or btrim(p_customer_id) = '' then
    return;
  end if;
  if to_regclass('public.customers') is null or to_regclass('public.organizations') is null then
    return;
  end if;
  return query
    select
      coalesce(nullif(c.app_id, ''), c.id::text),
      c.id
    from public.customers c
    join public.organizations o on o.id = c.organization_id
    where o.app_id = p_organization_id
      and (c.app_id = p_customer_id or c.id::text = p_customer_id)
      and coalesce(c.status::text, 'ACTIVE') = 'ACTIVE'
    limit 1;
end;
$$;

drop function if exists public.start_line_customer_bind_challenge(text, text);

create or replace function public.start_line_customer_bind_challenge(
  p_organization_id text,
  p_customer_id text,
  p_identity_confirmed boolean,
  p_bind_hmac_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.staff_auth_memberships%rowtype;
  v_customer record;
  v_id text;
  v_code text;
  v_hash text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_identity_confirmed is not true then
    raise exception 'identity not confirmed' using errcode = '22023';
  end if;
  if p_bind_hmac_key is null or p_bind_hmac_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid server key' using errcode = '22023';
  end if;
  select * into v_actor
  from public.staff_auth_memberships
  where auth_user_id = v_uid
    and organization_id = p_organization_id
    and is_active = true
    and role = 'OWNER'
  limit 1;
  if not found or not public.is_operational_staff_id(v_actor.user_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select r.customer_id, r.customer_uuid
  into v_customer
  from public.line_customer_binding_resolve(p_organization_id, p_customer_id) r;
  if v_customer.customer_id is null then
    raise exception 'invalid customer' using errcode = '22023';
  end if;

  update public.line_customer_bind_challenges
  set consumed_at = now()
  where organization_id = p_organization_id
    and customer_id = v_customer.customer_id
    and consumed_at is null;

  v_id := 'lcbc-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_hash := encode(sha256(convert_to(p_organization_id || ':' || v_code, 'utf8')), 'hex');

  insert into public.line_customer_bind_challenges (
    id, organization_id, customer_id, customer_uuid, staff_user_id,
    code_hash, identity_confirmed_at, expires_at
  ) values (
    v_id, p_organization_id, v_customer.customer_id, v_customer.customer_uuid,
    v_actor.user_id, v_hash, now(), v_expires
  );

  insert into public.line_customer_bind_challenge_secrets (
    challenge_id, organization_id, hmac_key
  ) values (
    v_id, p_organization_id, p_bind_hmac_key
  );

  return jsonb_build_object(
    'challenge_id', v_id,
    'organization_id', p_organization_id,
    'customer_id', v_customer.customer_id,
    'code', v_code,
    'expires_at', v_expires
  );
end;
$$;

comment on function public.start_line_customer_bind_challenge(text, text, boolean, text) is
  'Owner-only one-time customer bind code after in-person identity confirmation. Does not accept a LINE user id. HMAC key is never returned.';

drop function if exists public.consume_line_customer_bind_challenge_public(text, text, text, text, text, text, text);

create or replace function public.consume_line_customer_bind_challenge_public(
  p_organization_id text,
  p_public_token text,
  p_code text,
  p_event_id text,
  p_proof text,
  p_proof_issued_at timestamptz,
  p_line_user_id_cipher text,
  p_line_user_id_hint text,
  p_line_user_id_hash text,
  p_key_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.line_customer_bind_challenges%rowtype;
  v_hmac_key text;
  v_code_hash text;
  v_expected_proof text;
  v_canonical text;
  v_issued_unix bigint;
  v_binding_id text;
  v_conflict_id text;
  v_event_id text;
begin
  if to_regclass('public.line_webhook_public_tokens') is not null then
    if not public.line_webhook_public_token_matches(p_organization_id, p_public_token) then
      return jsonb_build_object('captured', false, 'bound', false, 'reason', 'unauthorized');
    end if;
  elsif p_public_token is null or btrim(p_public_token) = '' then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'unauthorized');
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'unauthorized');
  end if;
  if p_code is null or length(btrim(p_code)) < 6 then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'invalid_input');
  end if;
  if p_event_id is null or btrim(p_event_id) = '' then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'invalid_input');
  end if;
  if p_proof is null or p_proof !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'unauthorized');
  end if;
  if p_proof_issued_at is null
     or p_proof_issued_at < now() - interval '2 minutes'
     or p_proof_issued_at > now() + interval '30 seconds' then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'expired');
  end if;
  if p_line_user_id_cipher is null or p_line_user_id_cipher not like 'v1.%' then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'invalid_input');
  end if;
  if p_line_user_id_hint is null or p_line_user_id_hint not like '••••%' then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'invalid_input');
  end if;
  if p_line_user_id_hash is null or p_line_user_id_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'invalid_input');
  end if;

  v_code_hash := encode(
    sha256(convert_to(p_organization_id || ':' || upper(btrim(p_code)), 'utf8')),
    'hex'
  );

  select *
  into v_row
  from public.line_customer_bind_challenges
  where organization_id = p_organization_id
    and consumed_at is null
    and code_hash = v_code_hash
  for update;
  if not found then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'invalid_input');
  end if;

  if v_row.last_attempt_at is not null
     and v_row.last_attempt_at > now() - interval '2 seconds' then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'throttled');
  end if;

  if coalesce(v_row.failed_attempts, 0) >= 5 then
    update public.line_customer_bind_challenges
    set consumed_at = now(),
        last_attempt_at = now()
    where id = v_row.id;
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'attempt_limited');
  end if;

  if v_row.expires_at <= now() then
    update public.line_customer_bind_challenges
    set consumed_at = now(),
        last_attempt_at = now()
    where id = v_row.id;
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'expired');
  end if;

  select hmac_key
  into v_hmac_key
  from public.line_customer_bind_challenge_secrets
  where challenge_id = v_row.id
    and organization_id = p_organization_id;
  if v_hmac_key is null then
    update public.line_customer_bind_challenges
    set consumed_at = now(),
        last_attempt_at = now()
    where id = v_row.id;
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'unauthorized');
  end if;

  v_issued_unix := floor(extract(epoch from p_proof_issued_at));
  v_canonical :=
    'line-customer-bind-v1' || chr(10)
    || p_organization_id || chr(10)
    || p_public_token || chr(10)
    || btrim(p_event_id) || chr(10)
    || upper(btrim(p_code)) || chr(10)
    || p_line_user_id_hash || chr(10)
    || p_line_user_id_cipher || chr(10)
    || p_line_user_id_hint || chr(10)
    || coalesce(p_key_id, '') || chr(10)
    || v_issued_unix::text;
  v_expected_proof := encode(
    hmac(convert_to(v_canonical, 'utf8'), decode(v_hmac_key, 'hex'), 'sha256'),
    'hex'
  );
  if v_expected_proof is distinct from p_proof then
    update public.line_customer_bind_challenges
    set failed_attempts = coalesce(failed_attempts, 0) + 1,
        last_attempt_at = now(),
        consumed_at = case
          when coalesce(failed_attempts, 0) + 1 >= 5 then now()
          else consumed_at
        end
    where id = v_row.id;
    if coalesce(v_row.failed_attempts, 0) + 1 >= 5 then
      return jsonb_build_object('captured', false, 'bound', false, 'reason', 'attempt_limited');
    end if;
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'unauthorized');
  end if;

  if to_regclass('public.line_webhook_events') is not null then
    update public.line_webhook_events
    set bound = true
    where organization_id = p_organization_id
      and event_id = btrim(p_event_id)
      and bound is false
    returning event_id into v_event_id;
    if v_event_id is null then
      update public.line_customer_bind_challenges
      set failed_attempts = coalesce(failed_attempts, 0) + 1,
          last_attempt_at = now()
      where id = v_row.id;
      return jsonb_build_object('captured', false, 'bound', false, 'reason', 'duplicate');
    end if;
  elsif exists (
    select 1
    from public.line_customer_bind_challenges
    where organization_id = p_organization_id
      and consumed_event_id = btrim(p_event_id)
  ) then
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'duplicate');
  end if;

  select b.id
  into v_conflict_id
  from public.line_customer_bindings b
  where b.line_user_id_hash = p_line_user_id_hash
    and b.status in ('active', 'pending')
    and (
      b.organization_id is distinct from p_organization_id
      or b.customer_id is distinct from v_row.customer_id
    )
  limit 1;
  if v_conflict_id is not null then
    update public.line_customer_bind_challenges
    set consumed_at = now(),
        last_attempt_at = now()
    where id = v_row.id;
    return jsonb_build_object('captured', false, 'bound', false, 'reason', 'duplicate');
  end if;

  update public.line_customer_bind_challenges
  set consumed_at = now(),
      last_attempt_at = now(),
      consumed_event_id = btrim(p_event_id),
      consumed_proof_hash = p_proof
  where id = v_row.id;

  v_binding_id := coalesce(
    (
      select id
      from public.line_customer_bindings
      where organization_id = p_organization_id
        and customer_id = v_row.customer_id
      limit 1
    ),
    'lcb-' || substr(md5(p_organization_id || ':' || v_row.customer_id), 1, 20)
  );

  insert into public.line_customer_bindings (
    id, organization_id, customer_id, customer_uuid,
    line_user_id_hint, line_user_id_hash, bind_method,
    verified, status, captured_at, bound_at, confirmed_at, confirmed_by,
    unbound_at, updated_at
  ) values (
    v_binding_id, p_organization_id, v_row.customer_id, v_row.customer_uuid,
    p_line_user_id_hint, p_line_user_id_hash, 'webhook_code',
    false, 'pending', now(), null, null, null, null, now()
  )
  on conflict on constraint line_customer_bindings_org_customer_key do update
    set line_user_id_hint = excluded.line_user_id_hint,
        line_user_id_hash = excluded.line_user_id_hash,
        bind_method = 'webhook_code',
        verified = false,
        status = 'pending',
        captured_at = now(),
        bound_at = null,
        confirmed_at = null,
        confirmed_by = null,
        unbound_at = null,
        updated_at = now();

  insert into public.line_customer_binding_secrets (
    binding_id, organization_id, line_user_id_cipher, key_id, updated_at
  ) values (
    v_binding_id, p_organization_id, p_line_user_id_cipher, p_key_id, now()
  )
  on conflict (binding_id) do update
    set line_user_id_cipher = excluded.line_user_id_cipher,
        key_id = excluded.key_id,
        organization_id = excluded.organization_id,
        updated_at = now();

  return jsonb_build_object(
    'captured', true,
    'bound', false,
    'status', 'pending'
  );
end;
$$;

comment on function public.consume_line_customer_bind_challenge_public(text, text, text, text, text, timestamptz, text, text, text, text) is
  'Captures LINE identity after webhook HMAC and Channel-Secret server proof. Never marks the customer as a trusted recipient.';

create or replace function public.confirm_line_customer_binding(
  p_organization_id text,
  p_customer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.staff_auth_memberships%rowtype;
  v_customer record;
  v_id text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select * into v_actor
  from public.staff_auth_memberships
  where auth_user_id = v_uid
    and organization_id = p_organization_id
    and is_active = true
    and role = 'OWNER'
  limit 1;
  if not found or not public.is_operational_staff_id(v_actor.user_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select r.customer_id, r.customer_uuid
  into v_customer
  from public.line_customer_binding_resolve(p_organization_id, p_customer_id) r;
  if v_customer.customer_id is null then
    raise exception 'invalid customer' using errcode = '22023';
  end if;

  update public.line_customer_bindings
  set
    verified = true,
    status = 'active',
    bound_at = now(),
    confirmed_at = now(),
    confirmed_by = v_actor.user_id,
    unbound_at = null,
    updated_at = now()
  where organization_id = p_organization_id
    and customer_id = v_customer.customer_id
    and status = 'pending'
    and verified is not true
    and line_user_id_hash ~ '^[0-9a-f]{64}$'
  returning id into v_id;

  if v_id is null then
    raise exception 'binding not capturable' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.line_customer_binding_secrets where binding_id = v_id
  ) then
    update public.line_customer_bindings
    set verified = false, status = 'pending', bound_at = null, confirmed_at = null, confirmed_by = null
    where id = v_id;
    raise exception 'binding secret missing' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'customer_id', v_customer.customer_id,
    'verified', true,
    'status', 'active'
  );
end;
$$;

comment on function public.confirm_line_customer_binding(text, text) is
  'Owner-only in-person confirmation. Promotes a captured LINE identity to a trusted recipient. Does not accept a LINE user id.';

create or replace function public.unbind_line_customer_binding(
  p_organization_id text,
  p_customer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer record;
  v_id text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select r.customer_id, r.customer_uuid
  into v_customer
  from public.line_customer_binding_resolve(p_organization_id, p_customer_id) r;
  if v_customer.customer_id is null then
    select customer_id into v_customer.customer_id
    from public.line_customer_bindings
    where organization_id = p_organization_id
      and customer_id = p_customer_id
    limit 1;
  end if;
  if v_customer.customer_id is null then
    raise exception 'invalid customer' using errcode = '22023';
  end if;

  update public.line_customer_bind_challenges
  set consumed_at = now()
  where organization_id = p_organization_id
    and customer_id = v_customer.customer_id
    and consumed_at is null;

  update public.line_customer_bindings
  set
    verified = false,
    status = 'unbound',
    unbound_at = now(),
    confirmed_at = null,
    confirmed_by = null,
    bound_at = null,
    updated_at = now()
  where organization_id = p_organization_id
    and customer_id = v_customer.customer_id
    and status in ('active', 'pending')
  returning id into v_id;

  if v_id is not null then
    delete from public.line_customer_binding_secrets where binding_id = v_id;
  end if;

  if to_regclass('public.line_automation_jobs') is not null then
    update public.line_automation_jobs
    set
      status = case
        when status = 'scheduled' and recipient_ready is true then 'pending_recipient'
        else status
      end,
      recipient_ready = false,
      updated_at = now()
    where organization_id = p_organization_id
      and (
        customer_id = v_customer.customer_id
        or customer_app_id = v_customer.customer_id
      )
      and status in ('scheduled', 'pending_recipient');
  end if;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'customer_id', v_customer.customer_id,
    'bound', false,
    'verified', false
  );
end;
$$;

comment on function public.unbind_line_customer_binding(text, text) is
  'Owner-only unbind. Clears trusted recipient state and job recipient_ready. Does not accept or rewrite a LINE user id.';

create or replace function public.read_line_customer_bindings(
  p_organization_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'customers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'customer_id', coalesce(nullif(c.app_id, ''), c.id::text),
            'display_name', coalesce(nullif(c.preferred_name, ''), nullif(c.full_name, ''), coalesce(nullif(c.app_id, ''), c.id::text)),
            'binding', case
              when b.id is null then null
              else jsonb_build_object(
                'hint', b.line_user_id_hint,
                'verified', b.verified,
                'status', b.status,
                'captured_at', b.captured_at,
                'bound_at', b.bound_at,
                'confirmed_at', b.confirmed_at,
                'bind_method', b.bind_method
              )
            end
          )
          order by coalesce(nullif(c.preferred_name, ''), c.full_name, c.app_id)
        )
        from public.customers c
        join public.organizations o on o.id = c.organization_id
        left join public.line_customer_bindings b
          on b.organization_id = p_organization_id
         and (
           b.customer_id = c.app_id
           or b.customer_id = c.id::text
           or b.customer_uuid = c.id
         )
        where o.app_id = p_organization_id
          and coalesce(c.status::text, 'ACTIVE') = 'ACTIVE'
      ),
      '[]'::jsonb
    )
  );
end;
$$;

comment on function public.read_line_customer_bindings(text) is
  'Owner-only customer LINE binding status. Returns masked hint only.';

create or replace function public.line_automation_schedule_recipient_ready(
  p_organization_id text,
  p_customer_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.line_automation_schedule_customer_belongs(p_organization_id, p_customer_id) then
    return false;
  end if;
  if to_regclass('public.line_customer_bindings') is null then
    return false;
  end if;
  return exists (
    select 1
    from public.line_customer_bindings b
    where b.organization_id = p_organization_id
      and (
        b.customer_id = p_customer_id
        or b.customer_uuid::text = p_customer_id
      )
      and b.verified is true
      and b.status = 'active'
      and b.confirmed_at is not null
      and b.bind_method = 'webhook_code'
  );
end;
$$;

create or replace function public.line_automation_send_recipient_allowed(
  p_organization_id text,
  p_customer_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Future send path must call this. Job status scheduled is never sufficient.
  return public.line_automation_schedule_recipient_ready(p_organization_id, p_customer_id);
end;
$$;

comment on function public.line_automation_send_recipient_allowed(text, text) is
  'Send-time recipient check. Re-reads the trusted binding. Must not rely on job scheduled status.';

revoke all on function public.line_customer_binding_resolve(text, text) from public, anon, authenticated;
revoke all on function public.start_line_customer_bind_challenge(text, text, boolean, text) from public, anon;
grant execute on function public.start_line_customer_bind_challenge(text, text, boolean, text) to authenticated;
revoke all on function public.consume_line_customer_bind_challenge_public(text, text, text, text, text, timestamptz, text, text, text, text)
  from public, authenticated;
grant execute on function public.consume_line_customer_bind_challenge_public(text, text, text, text, text, timestamptz, text, text, text, text)
  to anon;
revoke all on function public.confirm_line_customer_binding(text, text) from public, anon;
grant execute on function public.confirm_line_customer_binding(text, text) to authenticated;
revoke all on function public.unbind_line_customer_binding(text, text) from public, anon;
grant execute on function public.unbind_line_customer_binding(text, text) to authenticated;
revoke all on function public.read_line_customer_bindings(text) from public, anon;
grant execute on function public.read_line_customer_bindings(text) to authenticated;
revoke all on function public.line_automation_schedule_recipient_ready(text, text)
  from public, anon, authenticated;
revoke all on function public.line_automation_send_recipient_allowed(text, text)
  from public, anon, authenticated;
