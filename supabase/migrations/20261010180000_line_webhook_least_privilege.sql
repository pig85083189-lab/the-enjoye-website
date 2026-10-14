-- =============================================================================
-- Beauty OS — LINE webhook least privilege (Phase 1D)
-- Additive. Does not rewrite 120000 / 140000 / 160000.
-- Replaces service-role webhook reads with token-gated SECURITY DEFINER RPCs.
-- Public RPCs return Channel Secret ciphertext only — never Access Token.
-- Bind codes stay one-time, 10 minutes, with attempt limits and event dedup.
-- Does not enable send. Does not rewrite existing LINE credentials.
-- =============================================================================

alter table public.line_owner_bind_challenges
  add column if not exists failed_attempts integer not null default 0;

alter table public.line_owner_bind_challenges
  add column if not exists last_attempt_at timestamptz;

alter table public.line_broadcast_events
  drop constraint if exists line_broadcast_events_type_check;

alter table public.line_broadcast_events
  add constraint line_broadcast_events_type_check
  check (
    event_type in (
      'draft_saved',
      'confirm_refused',
      'send_closed',
      'connection_tested',
      'broadcast_enabled',
      'broadcast_disabled',
      'api_accepted',
      'api_failed',
      'pending_confirmation',
      'send_claimed',
      'send_refused',
      'bind_started',
      'recipient_bound',
      'recipient_unbound',
      'test_push_enabled',
      'test_push_disabled',
      'test_send_claimed',
      'test_send_refused',
      'test_api_accepted',
      'test_api_failed',
      'test_pending_confirmation',
      'test_send_closed',
      'webhook_token_issued',
      'bind_attempt_limited'
    )
  );

create table if not exists public.line_webhook_public_tokens (
  organization_id text primary key
    references public.line_official_accounts (organization_id) on delete cascade,
  token_hash text not null,
  token_hint text not null,
  token_cipher text not null,
  key_id text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  constraint line_webhook_public_tokens_org_prefix
    check (organization_id like 'org-%'),
  constraint line_webhook_public_tokens_hint_mask
    check (token_hint like '••••%'),
  constraint line_webhook_public_tokens_cipher_prefix
    check (token_cipher like 'v1.%'),
  constraint line_webhook_public_tokens_hash_len
    check (length(token_hash) = 64)
);

comment on table public.line_webhook_public_tokens is
  'Org-scoped unguessable webhook token. Hash for verify; cipher for Owner redisplay. Never Access Token.';

create unique index if not exists line_webhook_public_tokens_hash_uidx
  on public.line_webhook_public_tokens (token_hash);

create table if not exists public.line_webhook_events (
  organization_id text not null
    references public.line_official_accounts (organization_id) on delete cascade,
  event_id text not null,
  processed_at timestamptz not null default now(),
  bound boolean not null default false,
  primary key (organization_id, event_id),
  constraint line_webhook_events_org_prefix
    check (organization_id like 'org-%'),
  constraint line_webhook_events_id_not_blank
    check (length(btrim(event_id)) > 0)
);

comment on table public.line_webhook_events is
  'LINE webhookEventId dedup. Replay of the same event is a no-op.';

alter table public.line_webhook_public_tokens enable row level security;
alter table public.line_webhook_events enable row level security;

revoke all on public.line_webhook_public_tokens from anon, authenticated, public;
revoke all on public.line_webhook_events from anon, authenticated, public;

create or replace function public.line_webhook_public_token_matches(
  p_organization_id text,
  p_public_token text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.line_webhook_public_tokens t
    where t.organization_id = p_organization_id
      and t.token_hash = encode(
        sha256(convert_to(p_organization_id || ':' || p_public_token, 'utf8')),
        'hex'
      )
  );
$$;

comment on function public.line_webhook_public_token_matches(text, text) is
  'Internal token check. Do not grant to clients.';

revoke all on function public.line_webhook_public_token_matches(text, text)
  from public, anon, authenticated;

create or replace function public.upsert_line_webhook_public_token(
  p_organization_id text,
  p_token_hash text,
  p_token_hint text,
  p_token_cipher text,
  p_key_id text,
  p_rotate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.line_webhook_public_tokens%rowtype;
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
  if not exists (
    select 1 from public.line_official_accounts a
    where a.organization_id = p_organization_id
  ) then
    raise exception 'not configured' using errcode = '22023';
  end if;

  select * into v_existing
  from public.line_webhook_public_tokens
  where organization_id = p_organization_id
  for update;

  if found and not coalesce(p_rotate, false) then
    return jsonb_build_object(
      'created', false,
      'organization_id', p_organization_id,
      'hint', v_existing.token_hint
    );
  end if;

  if p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  if p_token_hint is null or p_token_hint not like '••••%' then
    raise exception 'invalid hint' using errcode = '22023';
  end if;
  if p_token_cipher is null or p_token_cipher not like 'v1.%' then
    raise exception 'invalid token' using errcode = '22023';
  end if;

  insert into public.line_webhook_public_tokens (
    organization_id, token_hash, token_hint, token_cipher, key_id, created_at, rotated_at
  ) values (
    p_organization_id, p_token_hash, p_token_hint, p_token_cipher, p_key_id, now(), now()
  )
  on conflict (organization_id) do update
    set token_hash = excluded.token_hash,
        token_hint = excluded.token_hint,
        token_cipher = excluded.token_cipher,
        key_id = excluded.key_id,
        rotated_at = now();

  perform public.insert_line_broadcast_event(
    p_organization_id,
    null,
    'webhook_token_issued',
    p_token_hint
  );

  return jsonb_build_object(
    'created', true,
    'organization_id', p_organization_id,
    'hint', p_token_hint
  );
end;
$$;

comment on function public.upsert_line_webhook_public_token(text, text, text, text, text, boolean) is
  'Owner-only webhook token write. Does not touch Channel Secret or Access Token.';

create or replace function public.owner_read_line_webhook_token_cipher(
  p_organization_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.line_webhook_public_tokens%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select * into v_row
  from public.line_webhook_public_tokens
  where organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object(
    'configured', true,
    'token_cipher', v_row.token_cipher,
    'token_hint', v_row.token_hint,
    'key_id', v_row.key_id
  );
end;
$$;

comment on function public.owner_read_line_webhook_token_cipher(text) is
  'Owner-only webhook token ciphertext for URL redisplay. Never Access Token.';

create or replace function public.read_line_webhook_channel_secret_cipher(
  p_organization_id text,
  p_public_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cipher text;
  v_key_id text;
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return jsonb_build_object('configured', false);
  end if;
  if p_public_token is null or length(btrim(p_public_token)) < 32 then
    return jsonb_build_object('configured', false);
  end if;
  if not public.line_webhook_public_token_matches(p_organization_id, p_public_token) then
    return jsonb_build_object('configured', false);
  end if;
  select s.channel_secret_cipher, s.key_id
    into v_cipher, v_key_id
  from public.line_official_account_secrets s
  where s.organization_id = p_organization_id;
  if v_cipher is null then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object(
    'configured', true,
    'channel_secret_cipher', v_cipher,
    'key_id', v_key_id
  );
end;
$$;

comment on function public.read_line_webhook_channel_secret_cipher(text, text) is
  'Token-gated Channel Secret ciphertext only. Never Access Token or plaintext.';

create or replace function public.claim_line_webhook_event(
  p_organization_id text,
  p_public_token text,
  p_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return jsonb_build_object('accepted', false, 'duplicate', false);
  end if;
  if p_event_id is null or length(btrim(p_event_id)) = 0 then
    return jsonb_build_object('accepted', false, 'duplicate', false);
  end if;
  if not public.line_webhook_public_token_matches(p_organization_id, p_public_token) then
    return jsonb_build_object('accepted', false, 'duplicate', false);
  end if;
  insert into public.line_webhook_events (
    organization_id, event_id, processed_at, bound
  ) values (
    p_organization_id, btrim(p_event_id), now(), false
  )
  on conflict (organization_id, event_id) do nothing;
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', true);
  end if;
  return jsonb_build_object('accepted', true, 'duplicate', false);
end;
$$;

comment on function public.claim_line_webhook_event(text, text, text) is
  'Token-gated webhookEventId claim. Replay returns duplicate.';

create or replace function public.consume_line_owner_bind_challenge_public(
  p_organization_id text,
  p_public_token text,
  p_code text,
  p_line_user_id_cipher text,
  p_line_user_id_hint text,
  p_key_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.line_owner_bind_challenges%rowtype;
  v_hash text;
  v_attempts integer;
begin
  if not public.line_webhook_public_token_matches(p_organization_id, p_public_token) then
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

  v_hash := encode(
    sha256(convert_to(p_organization_id || ':' || upper(btrim(p_code)), 'utf8')),
    'hex'
  );

  select * into v_row
  from public.line_owner_bind_challenges
  where organization_id = p_organization_id
    and consumed_at is null
  for update;
  if not found then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;

  if v_row.expires_at <= now() then
    update public.line_owner_bind_challenges
    set consumed_at = now(),
        last_attempt_at = now()
    where id = v_row.id;
    return jsonb_build_object('bound', false, 'reason', 'expired');
  end if;

  if v_row.code_hash is distinct from v_hash then
    v_attempts := coalesce(v_row.failed_attempts, 0) + 1;
    update public.line_owner_bind_challenges
    set failed_attempts = v_attempts,
        last_attempt_at = now(),
        consumed_at = case when v_attempts >= 5 then now() else consumed_at end
    where id = v_row.id;
    if v_attempts >= 5 then
      perform public.insert_line_broadcast_event(
        p_organization_id, null, 'bind_attempt_limited', v_row.id
      );
      return jsonb_build_object('bound', false, 'reason', 'attempt_limited');
    end if;
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;

  update public.line_owner_bind_challenges
  set consumed_at = now(),
      last_attempt_at = now()
  where id = v_row.id;

  insert into public.line_owner_recipients (
    organization_id, staff_user_id, line_user_id_hint, bind_method, bound_at, updated_at
  ) values (
    p_organization_id, v_row.staff_user_id, p_line_user_id_hint, 'webhook_code', now(), now()
  )
  on conflict (organization_id) do update
    set staff_user_id = excluded.staff_user_id,
        line_user_id_hint = excluded.line_user_id_hint,
        bind_method = 'webhook_code',
        bound_at = now(),
        updated_at = now();

  insert into public.line_owner_recipient_secrets (
    organization_id, line_user_id_cipher, key_id, updated_at
  ) values (
    p_organization_id, p_line_user_id_cipher, p_key_id, now()
  )
  on conflict (organization_id) do update
    set line_user_id_cipher = excluded.line_user_id_cipher,
        key_id = excluded.key_id,
        updated_at = now();

  perform public.insert_line_broadcast_event(
    p_organization_id,
    null,
    'recipient_bound',
    p_line_user_id_hint
  );

  return jsonb_build_object(
    'bound', true,
    'organization_id', p_organization_id,
    'hint', p_line_user_id_hint
  );
end;
$$;

comment on function public.consume_line_owner_bind_challenge_public(text, text, text, text, text, text) is
  'Token-gated one-time bind. 10-minute expiry, 5 attempts, no plaintext user id.';

-- Keep the service-role consume path consistent with attempt limits.
create or replace function public.consume_line_owner_bind_challenge(
  p_organization_id text,
  p_code text,
  p_line_user_id_cipher text,
  p_line_user_id_hint text,
  p_key_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.line_owner_bind_challenges%rowtype;
  v_hash text;
  v_attempts integer;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;
  if p_code is null or length(btrim(p_code)) < 6 then
    raise exception 'invalid code' using errcode = '22023';
  end if;
  if p_line_user_id_cipher is null or p_line_user_id_cipher not like 'v1.%' then
    raise exception 'invalid recipient' using errcode = '22023';
  end if;
  if p_line_user_id_hint is null or p_line_user_id_hint not like '••••%' then
    raise exception 'invalid hint' using errcode = '22023';
  end if;

  v_hash := encode(
    sha256(convert_to(p_organization_id || ':' || upper(btrim(p_code)), 'utf8')),
    'hex'
  );

  select * into v_row
  from public.line_owner_bind_challenges
  where organization_id = p_organization_id
    and consumed_at is null
  for update;
  if not found then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;
  if v_row.expires_at <= now() then
    update public.line_owner_bind_challenges
    set consumed_at = now(), last_attempt_at = now()
    where id = v_row.id;
    return jsonb_build_object('bound', false, 'reason', 'expired');
  end if;
  if v_row.code_hash is distinct from v_hash then
    v_attempts := coalesce(v_row.failed_attempts, 0) + 1;
    update public.line_owner_bind_challenges
    set failed_attempts = v_attempts,
        last_attempt_at = now(),
        consumed_at = case when v_attempts >= 5 then now() else consumed_at end
    where id = v_row.id;
    if v_attempts >= 5 then
      return jsonb_build_object('bound', false, 'reason', 'attempt_limited');
    end if;
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;

  update public.line_owner_bind_challenges
  set consumed_at = now(), last_attempt_at = now()
  where id = v_row.id;

  insert into public.line_owner_recipients (
    organization_id, staff_user_id, line_user_id_hint, bind_method, bound_at, updated_at
  ) values (
    p_organization_id, v_row.staff_user_id, p_line_user_id_hint, 'webhook_code', now(), now()
  )
  on conflict (organization_id) do update
    set staff_user_id = excluded.staff_user_id,
        line_user_id_hint = excluded.line_user_id_hint,
        bind_method = 'webhook_code',
        bound_at = now(),
        updated_at = now();

  insert into public.line_owner_recipient_secrets (
    organization_id, line_user_id_cipher, key_id, updated_at
  ) values (
    p_organization_id, p_line_user_id_cipher, p_key_id, now()
  )
  on conflict (organization_id) do update
    set line_user_id_cipher = excluded.line_user_id_cipher,
        key_id = excluded.key_id,
        updated_at = now();

  perform public.insert_line_broadcast_event(
    p_organization_id, null, 'recipient_bound', p_line_user_id_hint
  );

  return jsonb_build_object(
    'bound', true,
    'organization_id', p_organization_id,
    'hint', p_line_user_id_hint
  );
end;
$$;

revoke all on function public.upsert_line_webhook_public_token(text, text, text, text, text, boolean)
  from public, anon;
grant execute on function public.upsert_line_webhook_public_token(text, text, text, text, text, boolean)
  to authenticated;

revoke all on function public.owner_read_line_webhook_token_cipher(text)
  from public, anon;
grant execute on function public.owner_read_line_webhook_token_cipher(text)
  to authenticated;

revoke all on function public.read_line_webhook_channel_secret_cipher(text, text)
  from public;
grant execute on function public.read_line_webhook_channel_secret_cipher(text, text)
  to anon, authenticated;

revoke all on function public.claim_line_webhook_event(text, text, text)
  from public;
grant execute on function public.claim_line_webhook_event(text, text, text)
  to anon, authenticated;

revoke all on function public.consume_line_owner_bind_challenge_public(text, text, text, text, text, text)
  from public;
grant execute on function public.consume_line_owner_bind_challenge_public(text, text, text, text, text, text)
  to anon, authenticated;

-- Service-role secret reader stays ungranted. Webhook no longer needs it.
revoke all on function public.read_line_channel_secret_cipher(text)
  from public, anon, authenticated;
revoke all on function public.consume_line_owner_bind_challenge(text, text, text, text, text)
  from public, anon, authenticated;
