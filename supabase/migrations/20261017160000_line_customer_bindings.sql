-- Formal LINE customer bindings for Phase 2B recipient verification.
-- Reuses webhook_code + Channel Secret signature. Does not accept a
-- client-supplied LINE user id. Does not send LINE, open Cron, or
-- rewrite Broadcast / Phase 2B reminder RPCs / existing jobs.
-- Do not apply on Production until Owner confirms.

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
  bound_at timestamptz,
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
  constraint line_customer_bindings_verified_active
    check (
      (verified is true and status = 'active' and bound_at is not null)
      or (verified is not true)
    )
);

comment on table public.line_customer_bindings is
  'Verified customer LINE binding metadata. Ciphertext lives in line_customer_binding_secrets. Never stores plaintext LINE user id.';

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
  'Encrypted LINE user id for a verified customer binding. No authenticated grants.';

create table if not exists public.line_customer_bind_challenges (
  id text primary key,
  organization_id text not null,
  customer_id text not null,
  customer_uuid uuid,
  staff_user_id text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
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
  'One-time customer bind codes. Plaintext code is returned once and never stored.';

create unique index if not exists line_customer_bind_challenges_one_open
  on public.line_customer_bind_challenges (organization_id, customer_id)
  where consumed_at is null;

alter table public.line_customer_bindings enable row level security;
alter table public.line_customer_binding_secrets enable row level security;
alter table public.line_customer_bind_challenges enable row level security;

revoke all on public.line_customer_bindings from anon, authenticated, public;
revoke all on public.line_customer_binding_secrets from anon, authenticated, public;
revoke all on public.line_customer_bind_challenges from anon, authenticated, public;

grant select on public.line_customer_bindings to authenticated;

drop policy if exists line_customer_bindings_select_owner
  on public.line_customer_bindings;
create policy line_customer_bindings_select_owner
on public.line_customer_bindings
for select
to authenticated
using (public.user_is_org_owner(organization_id));

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

create or replace function public.start_line_customer_bind_challenge(
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
    id, organization_id, customer_id, customer_uuid, staff_user_id, code_hash, expires_at
  ) values (
    v_id, p_organization_id, v_customer.customer_id, v_customer.customer_uuid,
    v_actor.user_id, v_hash, v_expires
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

comment on function public.start_line_customer_bind_challenge(text, text) is
  'Owner-only one-time customer bind code. Does not accept a LINE user id.';

create or replace function public.consume_line_customer_bind_challenge_public(
  p_organization_id text,
  p_public_token text,
  p_code text,
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
  v_code_hash text;
  v_binding_id text;
  v_conflict_id text;
begin
  if to_regclass('public.line_webhook_public_tokens') is not null then
    if not public.line_webhook_public_token_matches(p_organization_id, p_public_token) then
      return jsonb_build_object('bound', false, 'reason', 'unauthorized');
    end if;
  elsif p_public_token is null or btrim(p_public_token) = '' then
    return jsonb_build_object('bound', false, 'reason', 'unauthorized');
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return jsonb_build_object('bound', false, 'reason', 'unauthorized');
  end if;
  if p_code is null or length(btrim(p_code)) < 6 then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;
  if p_line_user_id_cipher is null or p_line_user_id_cipher not like 'v1.%' then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;
  if p_line_user_id_hint is null or p_line_user_id_hint not like '••••%' then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;
  if p_line_user_id_hash is null or p_line_user_id_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
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
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;

  if v_row.expires_at <= now() then
    update public.line_customer_bind_challenges
    set consumed_at = now(),
        last_attempt_at = now()
    where id = v_row.id;
    return jsonb_build_object('bound', false, 'reason', 'expired');
  end if;

  select b.id
  into v_conflict_id
  from public.line_customer_bindings b
  where b.line_user_id_hash = p_line_user_id_hash
    and b.status = 'active'
    and b.verified is true
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
    return jsonb_build_object('bound', false, 'reason', 'duplicate');
  end if;

  update public.line_customer_bind_challenges
  set consumed_at = now(),
      last_attempt_at = now()
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
    verified, status, bound_at, unbound_at, updated_at
  ) values (
    v_binding_id, p_organization_id, v_row.customer_id, v_row.customer_uuid,
    p_line_user_id_hint, p_line_user_id_hash, 'webhook_code',
    true, 'active', now(), null, now()
  )
  on conflict on constraint line_customer_bindings_org_customer_key do update
    set line_user_id_hint = excluded.line_user_id_hint,
        line_user_id_hash = excluded.line_user_id_hash,
        bind_method = 'webhook_code',
        verified = true,
        status = 'active',
        bound_at = now(),
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
    'bound', true,
    'organization_id', p_organization_id,
    'customer_id', v_row.customer_id,
    'hint', p_line_user_id_hint
  );
end;
$$;

comment on function public.consume_line_customer_bind_challenge_public(text, text, text, text, text, text, text) is
  'Token-gated customer bind after webhook signature verification. Never stores plaintext user id.';

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
    updated_at = now()
  where organization_id = p_organization_id
    and customer_id = v_customer.customer_id
    and status = 'active'
  returning id into v_id;

  if v_id is not null then
    delete from public.line_customer_binding_secrets where binding_id = v_id;
  end if;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'customer_id', v_customer.customer_id,
    'bound', false
  );
end;
$$;

comment on function public.unbind_line_customer_binding(text, text) is
  'Owner-only unbind. Does not accept or rewrite a LINE user id.';

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
                'bound_at', b.bound_at,
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
  -- Trusted customer LINE bindings only. Never RPC payload or customers.line_user_id.
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
      and b.bind_method = 'webhook_code'
  );
end;
$$;

revoke all on function public.line_customer_binding_resolve(text, text) from public, anon, authenticated;
revoke all on function public.start_line_customer_bind_challenge(text, text) from public, anon;
grant execute on function public.start_line_customer_bind_challenge(text, text) to authenticated;
revoke all on function public.consume_line_customer_bind_challenge_public(text, text, text, text, text, text, text)
  from public, authenticated;
grant execute on function public.consume_line_customer_bind_challenge_public(text, text, text, text, text, text, text)
  to anon;
revoke all on function public.unbind_line_customer_binding(text, text) from public, anon;
grant execute on function public.unbind_line_customer_binding(text, text) to authenticated;
revoke all on function public.read_line_customer_bindings(text) from public, anon;
grant execute on function public.read_line_customer_bindings(text) to authenticated;
revoke all on function public.line_automation_schedule_recipient_ready(text, text)
  from public, anon, authenticated;
