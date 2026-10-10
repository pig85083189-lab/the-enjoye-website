-- =============================================================================
-- Beauty OS — LINE owner test-push bind (Phase 1C)
-- Additive. Reuses Organization isolation. Does not rewrite 120000 / 140000.
-- Test Push and Broadcast stay independently application-closed.
-- Recipient identity comes from a signed webhook + one-time code.
-- Console Channel admin User IDs are not accepted as verified recipients.
-- =============================================================================

alter table public.line_official_accounts
  add column if not exists test_push_enabled boolean not null default false;

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
      'test_send_closed'
    )
  );

create table if not exists public.line_owner_recipients (
  organization_id text primary key
    references public.line_official_accounts (organization_id) on delete cascade,
  staff_user_id text not null,
  line_user_id_hint text not null,
  bind_method text not null default 'webhook_code',
  bound_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_owner_recipients_org_prefix
    check (organization_id like 'org-%'),
  constraint line_owner_recipients_staff_operational
    check (public.is_operational_staff_id(staff_user_id)),
  constraint line_owner_recipients_method_check
    check (bind_method = 'webhook_code'),
  constraint line_owner_recipients_hint_mask
    check (line_user_id_hint like '••••%')
);

comment on table public.line_owner_recipients is
  'Verified Owner LINE recipient metadata. Ciphertext lives in line_owner_recipient_secrets.';

create table if not exists public.line_owner_recipient_secrets (
  organization_id text primary key
    references public.line_owner_recipients (organization_id) on delete cascade,
  line_user_id_cipher text not null,
  key_id text not null,
  updated_at timestamptz not null default now(),
  constraint line_owner_recipient_secrets_org_prefix
    check (organization_id like 'org-%'),
  constraint line_owner_recipient_secrets_cipher_prefix
    check (line_user_id_cipher like 'v1.%')
);

comment on table public.line_owner_recipient_secrets is
  'Encrypted LINE user id for Owner test push. No authenticated grants.';

create table if not exists public.line_owner_bind_challenges (
  id text primary key,
  organization_id text not null,
  staff_user_id text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint line_owner_bind_challenges_id_prefix
    check (id like 'lbc-%'),
  constraint line_owner_bind_challenges_org_prefix
    check (organization_id like 'org-%'),
  constraint line_owner_bind_challenges_staff_operational
    check (public.is_operational_staff_id(staff_user_id))
);

comment on table public.line_owner_bind_challenges is
  'One-time Owner bind codes. Plaintext code is returned once and never stored.';

create unique index if not exists line_owner_bind_challenges_one_open
  on public.line_owner_bind_challenges (organization_id)
  where consumed_at is null;

create table if not exists public.line_test_sends (
  id text primary key,
  organization_id text not null,
  status text not null default 'draft',
  text_body text not null,
  request_id text not null,
  line_request_id text,
  api_result text,
  error_message text,
  created_by_staff_id text not null,
  confirmed_by_staff_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint line_test_sends_id_prefix
    check (id like 'lts-%'),
  constraint line_test_sends_org_prefix
    check (organization_id like 'org-%'),
  constraint line_test_sends_request_prefix
    check (request_id like 'ltsq-%'),
  constraint line_test_sends_status_check
    check (
      status in (
        'draft',
        'confirm_pending',
        'send_closed',
        'queued',
        'sending',
        'accepted',
        'failed',
        'canceled',
        'pending_confirmation'
      )
    ),
  constraint line_test_sends_api_result_check
    check (
      api_result is null
      or api_result in ('accepted', 'failed', 'pending_confirmation', 'send_closed')
    ),
  constraint line_test_sends_text_not_blank
    check (length(btrim(text_body)) > 0 and length(text_body) <= 5000),
  constraint line_test_sends_creator_operational
    check (public.is_operational_staff_id(created_by_staff_id))
);

comment on table public.line_test_sends is
  'Owner-only test Push records. Separate from Broadcast. accepted means API accepted.';

create unique index if not exists line_test_sends_one_request_per_org
  on public.line_test_sends (organization_id, request_id);

create index if not exists line_test_sends_org_created_idx
  on public.line_test_sends (organization_id, created_at desc);

alter table public.line_owner_recipients enable row level security;
alter table public.line_owner_recipient_secrets enable row level security;
alter table public.line_owner_bind_challenges enable row level security;
alter table public.line_test_sends enable row level security;

revoke all on public.line_owner_recipients from anon, authenticated, public;
revoke all on public.line_owner_recipient_secrets from anon, authenticated, public;
revoke all on public.line_owner_bind_challenges from anon, authenticated, public;
revoke all on public.line_test_sends from anon, authenticated, public;

grant select on public.line_owner_recipients to authenticated;
grant select on public.line_test_sends to authenticated;

create policy line_owner_recipients_select_owner
on public.line_owner_recipients
for select
to authenticated
using (public.user_is_org_owner(organization_id));

create policy line_test_sends_select_owner
on public.line_test_sends
for select
to authenticated
using (public.user_is_org_owner(organization_id));

create or replace function public.read_line_channel_secret_cipher(
  p_organization_id text
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
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
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

comment on function public.read_line_channel_secret_cipher(text) is
  'Service role only. Channel Secret ciphertext for webhook signature verify. Never token or plaintext.';

revoke all on function public.read_line_channel_secret_cipher(text)
  from public, anon, authenticated;

create or replace function public.start_line_owner_bind_challenge(
  p_organization_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.staff_auth_memberships%rowtype;
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

  update public.line_owner_bind_challenges
  set consumed_at = now()
  where organization_id = p_organization_id
    and consumed_at is null;

  v_id := 'lbc-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_hash := encode(sha256(convert_to(p_organization_id || ':' || v_code, 'utf8')), 'hex');

  insert into public.line_owner_bind_challenges (
    id, organization_id, staff_user_id, code_hash, expires_at
  ) values (
    v_id, p_organization_id, v_actor.user_id, v_hash, v_expires
  );

  perform public.insert_line_broadcast_event(
    p_organization_id,
    null,
    'bind_started',
    v_id
  );

  return jsonb_build_object(
    'challenge_id', v_id,
    'code', v_code,
    'expires_at', v_expires
  );
end;
$$;

comment on function public.start_line_owner_bind_challenge(text) is
  'Owner-only one-time bind code. Does not accept a LINE user id.';

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
    and expires_at > now()
    and code_hash = v_hash
  for update;
  if not found then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;

  update public.line_owner_bind_challenges
  set consumed_at = now()
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

comment on function public.consume_line_owner_bind_challenge(text, text, text, text, text) is
  'Service role only. Bind after webhook signature verification. Never stores plaintext user id.';

revoke all on function public.consume_line_owner_bind_challenge(text, text, text, text, text)
  from public, anon, authenticated;

create or replace function public.unbind_line_owner_recipient(
  p_organization_id text
)
returns jsonb
language plpgsql
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
  delete from public.line_owner_recipients where organization_id = p_organization_id;
  perform public.insert_line_broadcast_event(
    p_organization_id, null, 'recipient_unbound', 'owner unbound test recipient'
  );
  return jsonb_build_object('organization_id', p_organization_id, 'bound', false);
end;
$$;

create or replace function public.owner_read_line_recipient_user_id_cipher(
  p_organization_id text
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
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select s.line_user_id_cipher, s.key_id
    into v_cipher, v_key_id
  from public.line_owner_recipient_secrets s
  where s.organization_id = p_organization_id;
  if v_cipher is null then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object(
    'configured', true,
    'line_user_id_cipher', v_cipher,
    'key_id', v_key_id
  );
end;
$$;

comment on function public.owner_read_line_recipient_user_id_cipher(text) is
  'Owner-only recipient ciphertext for test Push. Never plaintext or Channel Token.';

create or replace function public.set_line_test_push_enabled(
  p_organization_id text,
  p_enabled boolean
)
returns jsonb
language plpgsql
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
  update public.line_official_accounts
  set test_push_enabled = coalesce(p_enabled, false),
      updated_at = now()
  where organization_id = p_organization_id;
  if not found then
    raise exception 'not configured' using errcode = '22023';
  end if;
  perform public.insert_line_broadcast_event(
    p_organization_id,
    null,
    case when coalesce(p_enabled, false) then 'test_push_enabled' else 'test_push_disabled' end,
    'owner test push flag'
  );
  return jsonb_build_object(
    'organization_id', p_organization_id,
    'test_push_enabled', coalesce(p_enabled, false)
  );
end;
$$;

create or replace function public.upsert_line_test_send_draft(
  p_organization_id text,
  p_test_send_id text,
  p_request_id text,
  p_text_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.staff_auth_memberships%rowtype;
  v_id text;
  v_existing public.line_test_sends%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_text_body is null or length(btrim(p_text_body)) = 0 or length(p_text_body) > 5000 then
    raise exception 'invalid text' using errcode = '22023';
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

  if p_test_send_id is not null and p_test_send_id like 'lts-%' then
    select * into v_existing from public.line_test_sends where id = p_test_send_id for update;
    if found then
      if v_existing.organization_id is distinct from p_organization_id then
        raise exception 'unauthorized' using errcode = '42501';
      end if;
      if v_existing.status is distinct from 'draft' then
        raise exception 'invalid test send' using errcode = '22023';
      end if;
      update public.line_test_sends
      set text_body = p_text_body, updated_at = now()
      where id = v_existing.id;
      v_id := v_existing.id;
    end if;
  end if;

  if v_id is null then
    if p_request_id is null or p_request_id not like 'ltsq-%' then
      raise exception 'invalid request' using errcode = '22023';
    end if;
    select * into v_existing
    from public.line_test_sends
    where organization_id = p_organization_id and request_id = p_request_id
    for update;
    if found then
      if v_existing.status is distinct from 'draft' then
        return jsonb_build_object(
          'test_send_id', v_existing.id,
          'request_id', v_existing.request_id,
          'status', v_existing.status,
          'reused', true
        );
      end if;
      update public.line_test_sends
      set text_body = p_text_body, updated_at = now()
      where id = v_existing.id;
      v_id := v_existing.id;
    else
      v_id := 'lts-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
      insert into public.line_test_sends (
        id, organization_id, status, text_body, request_id, created_by_staff_id
      ) values (
        v_id, p_organization_id, 'draft', p_text_body, p_request_id, v_actor.user_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'test_send_id', v_id,
    'request_id', coalesce(p_request_id, v_existing.request_id),
    'status', 'draft'
  );
end;
$$;

create or replace function public.claim_line_test_send(
  p_organization_id text,
  p_test_send_id text,
  p_request_id text,
  p_text_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.staff_auth_memberships%rowtype;
  v_row public.line_test_sends%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_request_id is null or p_request_id not like 'ltsq-%' then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.line_owner_recipients r
    where r.organization_id = p_organization_id
  ) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'not_configured',
      'message', '請先完成店長 LINE 綁定'
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

  if p_test_send_id is not null and p_test_send_id like 'lts-%' then
    select * into v_row from public.line_test_sends where id = p_test_send_id for update;
  end if;
  if v_row.id is null then
    select * into v_row
    from public.line_test_sends
    where organization_id = p_organization_id and request_id = p_request_id
    for update;
  end if;
  if v_row.id is null then
    return jsonb_build_object('claimed', false, 'reason', 'invalid_input', 'message', '找不到測試草稿');
  end if;
  if v_row.organization_id is distinct from p_organization_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_row.request_id is distinct from p_request_id then
    return jsonb_build_object('claimed', false, 'reason', 'invalid_input', 'message', '發送識別不一致');
  end if;
  if v_row.status = 'accepted' then
    return jsonb_build_object('claimed', false, 'reason', 'duplicate', 'message', '這則測試已被 LINE API 接受，不會重送');
  end if;
  if v_row.status in ('pending_confirmation', 'sending') then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'pending_confirmation',
      'message', '測試發送結果待確認，系統不會自動重送'
    );
  end if;
  if v_row.status not in ('draft', 'confirm_pending', 'failed', 'queued') then
    return jsonb_build_object('claimed', false, 'reason', 'send_closed', 'message', '這則測試不能再發送');
  end if;

  update public.line_test_sends
  set status = 'sending',
      text_body = p_text_body,
      confirmed_by_staff_id = v_actor.user_id,
      confirmed_at = now(),
      updated_at = now(),
      error_message = null
  where id = v_row.id
    and organization_id = p_organization_id
    and request_id = p_request_id
    and status = v_row.status;
  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'pending_confirmation',
      'message', '測試發送進行中，請勿重複送出'
    );
  end if;

  perform public.insert_line_broadcast_event(
    p_organization_id, null, 'test_send_claimed', left(p_request_id, 80)
  );
  return jsonb_build_object(
    'claimed', true,
    'broadcast_id', v_row.id,
    'test_send_id', v_row.id,
    'request_id', v_row.request_id,
    'status', 'sending'
  );
end;
$$;

create or replace function public.complete_line_test_send(
  p_organization_id text,
  p_test_send_id text,
  p_request_id text,
  p_status text,
  p_api_result text,
  p_line_request_id text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.line_test_sends%rowtype;
  v_event text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_status is null or p_status not in (
    'accepted', 'failed', 'pending_confirmation', 'send_closed'
  ) then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select * into v_row
  from public.line_test_sends
  where id = p_test_send_id
    and organization_id = p_organization_id
    and request_id = p_request_id
  for update;
  if not found then
    raise exception 'invalid test send' using errcode = '22023';
  end if;
  if v_row.status is distinct from 'sending' then
    return jsonb_build_object(
      'test_send_id', v_row.id,
      'status', v_row.status,
      'completed', false
    );
  end if;
  update public.line_test_sends
  set status = p_status,
      api_result = p_api_result,
      line_request_id = coalesce(nullif(p_line_request_id, ''), line_request_id),
      error_message = nullif(p_error_message, ''),
      updated_at = now()
  where id = v_row.id;
  v_event := case p_status
    when 'accepted' then 'test_api_accepted'
    when 'pending_confirmation' then 'test_pending_confirmation'
    when 'send_closed' then 'test_send_closed'
    else 'test_api_failed'
  end;
  perform public.insert_line_broadcast_event(
    p_organization_id, null, v_event, left(coalesce(p_error_message, p_api_result), 200)
  );
  return jsonb_build_object(
    'test_send_id', v_row.id,
    'status', p_status,
    'api_result', p_api_result,
    'completed', true
  );
end;
$$;

revoke all on function public.start_line_owner_bind_challenge(text) from public, anon;
grant execute on function public.start_line_owner_bind_challenge(text) to authenticated;
revoke all on function public.unbind_line_owner_recipient(text) from public, anon;
grant execute on function public.unbind_line_owner_recipient(text) to authenticated;
revoke all on function public.owner_read_line_recipient_user_id_cipher(text) from public, anon;
grant execute on function public.owner_read_line_recipient_user_id_cipher(text) to authenticated;
revoke all on function public.set_line_test_push_enabled(text, boolean) from public, anon;
grant execute on function public.set_line_test_push_enabled(text, boolean) to authenticated;
revoke all on function public.upsert_line_test_send_draft(text, text, text, text) from public, anon;
grant execute on function public.upsert_line_test_send_draft(text, text, text, text) to authenticated;
revoke all on function public.claim_line_test_send(text, text, text, text) from public, anon;
grant execute on function public.claim_line_test_send(text, text, text, text) to authenticated;
revoke all on function public.complete_line_test_send(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.complete_line_test_send(text, text, text, text, text, text, text)
  to authenticated;
