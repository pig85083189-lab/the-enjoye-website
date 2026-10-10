-- =============================================================================
-- Beauty OS — LINE Official Account foundation (Phase 1)
-- Additive only. One Messaging API connection per Organization.
-- Secrets never grant SELECT/INSERT/UPDATE to authenticated or anon.
-- Broadcast is Owner-only. Send stays application-closed in Phase 1.
-- Does not invent friend counts, member segments, or a second RBAC.
-- =============================================================================

create table if not exists public.line_official_accounts (
  organization_id text primary key,
  channel_id text,
  bot_display_name text,
  bot_basic_id text,
  token_hint text,
  secret_configured boolean not null default false,
  token_configured boolean not null default false,
  broadcast_enabled boolean not null default false,
  last_tested_at timestamptz,
  last_test_status text,
  last_test_message text,
  updated_by_staff_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_official_accounts_org_prefix
    check (organization_id like 'org-%'),
  constraint line_official_accounts_test_status_check
    check (
      last_test_status is null
      or last_test_status in ('ok', 'failed', 'not_configured')
    ),
  constraint line_official_accounts_updater_operational
    check (
      updated_by_staff_id is null
      or public.is_operational_staff_id(updated_by_staff_id)
    )
);

comment on table public.line_official_accounts is
  'Per-organization LINE Official Account metadata. Secrets live in line_official_account_secrets and are never selected here.';

create table if not exists public.line_official_account_secrets (
  organization_id text primary key
    references public.line_official_accounts (organization_id) on delete cascade,
  channel_secret_cipher text not null,
  channel_access_token_cipher text not null,
  key_id text not null,
  updated_at timestamptz not null default now(),
  constraint line_official_account_secrets_org_prefix
    check (organization_id like 'org-%'),
  constraint line_official_account_secrets_cipher_prefix
    check (
      channel_secret_cipher like 'v1.%'
      and channel_access_token_cipher like 'v1.%'
    )
);

comment on table public.line_official_account_secrets is
  'Encrypted LINE channel secret and access token. No authenticated table grants. Server decrypts after Owner authorization.';

create table if not exists public.line_broadcasts (
  id text primary key,
  organization_id text not null,
  status text not null default 'draft',
  text_body text not null,
  request_id text not null,
  line_request_id text,
  api_result text,
  error_code text,
  error_message text,
  created_by_staff_id text not null,
  confirmed_by_staff_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint line_broadcasts_id_prefix
    check (id like 'lbr-%'),
  constraint line_broadcasts_org_prefix
    check (organization_id like 'org-%'),
  constraint line_broadcasts_request_prefix
    check (request_id like 'lbrq-%'),
  constraint line_broadcasts_status_check
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
  constraint line_broadcasts_api_result_check
    check (
      api_result is null
      or api_result in ('accepted', 'failed', 'pending_confirmation', 'send_closed')
    ),
  constraint line_broadcasts_text_not_blank
    check (length(btrim(text_body)) > 0 and length(text_body) <= 5000),
  constraint line_broadcasts_creator_operational
    check (public.is_operational_staff_id(created_by_staff_id))
);

comment on table public.line_broadcasts is
  'Organization-scoped LINE text broadcasts. accepted means LINE API accepted the request, not per-friend delivery.';

create unique index if not exists line_broadcasts_one_request_per_org
  on public.line_broadcasts (organization_id, request_id);

create index if not exists line_broadcasts_org_created_idx
  on public.line_broadcasts (organization_id, created_at desc);

create table if not exists public.line_broadcast_events (
  id text primary key,
  broadcast_id text references public.line_broadcasts (id) on delete cascade,
  organization_id text not null,
  event_type text not null,
  detail text,
  created_by_staff_id text,
  created_at timestamptz not null default now(),
  constraint line_broadcast_events_id_prefix
    check (id like 'lbe-%'),
  constraint line_broadcast_events_org_prefix
    check (organization_id like 'org-%'),
  constraint line_broadcast_events_type_check
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
        'pending_confirmation'
      )
    )
);

comment on table public.line_broadcast_events is
  'Append-only LINE broadcast / connection audit. No friend-delivery claims.';

create index if not exists line_broadcast_events_org_created_idx
  on public.line_broadcast_events (organization_id, created_at desc);

alter table public.line_official_accounts enable row level security;
alter table public.line_official_account_secrets enable row level security;
alter table public.line_broadcasts enable row level security;
alter table public.line_broadcast_events enable row level security;

revoke all on public.line_official_accounts from anon, authenticated, public;
revoke all on public.line_official_account_secrets from anon, authenticated, public;
revoke all on public.line_broadcasts from anon, authenticated, public;
revoke all on public.line_broadcast_events from anon, authenticated, public;

grant select on public.line_official_accounts to authenticated;
grant select on public.line_broadcasts to authenticated;
grant select, insert on public.line_broadcast_events to authenticated;

create or replace function public.user_is_org_owner(target_org_app_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_auth_memberships m
    join public.organizations o on o.app_id = m.organization_id
    where m.organization_id = target_org_app_id
      and m.auth_user_id = auth.uid()
      and m.is_active = true
      and m.role = 'OWNER'
      and public.user_has_org_membership(o.id)
  );
$$;

comment on function public.user_is_org_owner(text) is
  'Active Owner membership for an organization app_id. Reuses staff_auth_memberships, not a second RBAC.';

revoke all on function public.user_is_org_owner(text) from public, anon;
grant execute on function public.user_is_org_owner(text) to authenticated;

drop policy if exists line_official_accounts_select_owner
  on public.line_official_accounts;
create policy line_official_accounts_select_owner
on public.line_official_accounts
for select
to authenticated
using (public.user_is_org_owner(organization_id));

drop policy if exists line_broadcasts_select_owner
  on public.line_broadcasts;
create policy line_broadcasts_select_owner
on public.line_broadcasts
for select
to authenticated
using (public.user_is_org_owner(organization_id));

drop policy if exists line_broadcast_events_select_owner
  on public.line_broadcast_events;
create policy line_broadcast_events_select_owner
on public.line_broadcast_events
for select
to authenticated
using (public.user_is_org_owner(organization_id));

drop policy if exists line_broadcast_events_insert_owner
  on public.line_broadcast_events;
create policy line_broadcast_events_insert_owner
on public.line_broadcast_events
for insert
to authenticated
with check (
  public.user_is_org_owner(organization_id)
  and (
    created_by_staff_id is null
    or created_by_staff_id = public.user_operational_staff_id(
      (select o.id from public.organizations o where o.app_id = organization_id)
    )
  )
);

-- Secrets: no authenticated policies. Service role / SECURITY DEFINER only.
drop policy if exists line_official_account_secrets_deny_authenticated
  on public.line_official_account_secrets;

create or replace function public.insert_line_broadcast_event(
  p_organization_id text,
  p_broadcast_id text,
  p_event_type text,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.line_broadcast_events (
    id,
    broadcast_id,
    organization_id,
    event_type,
    detail,
    created_by_staff_id
  ) values (
    'lbe-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
    p_broadcast_id,
    p_organization_id,
    p_event_type,
    p_detail,
    public.user_operational_staff_id(
      (select o.id from public.organizations o where o.app_id = p_organization_id)
    )
  );
end;
$$;

comment on function public.insert_line_broadcast_event(text, text, text, text) is
  'Internal LINE audit helper. Not granted to authenticated.';

revoke all on function public.insert_line_broadcast_event(text, text, text, text)
  from public, anon, authenticated;

create or replace function public.upsert_line_official_account_connection(
  p_organization_id text,
  p_channel_id text,
  p_channel_secret_cipher text,
  p_channel_access_token_cipher text,
  p_key_id text,
  p_token_hint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.staff_auth_memberships%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;
  if p_channel_secret_cipher is null or p_channel_secret_cipher not like 'v1.%' then
    raise exception 'invalid secret' using errcode = '22023';
  end if;
  if p_channel_access_token_cipher is null or p_channel_access_token_cipher not like 'v1.%' then
    raise exception 'invalid token' using errcode = '22023';
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
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not public.is_operational_staff_id(v_actor.user_id) then
    raise exception 'invalid actor' using errcode = '42501';
  end if;

  insert into public.line_official_accounts (
    organization_id,
    channel_id,
    token_hint,
    secret_configured,
    token_configured,
    updated_by_staff_id,
    updated_at
  ) values (
    p_organization_id,
    nullif(btrim(p_channel_id), ''),
    nullif(btrim(p_token_hint), ''),
    true,
    true,
    v_actor.user_id,
    now()
  )
  on conflict (organization_id) do update
    set channel_id = excluded.channel_id,
        token_hint = excluded.token_hint,
        secret_configured = true,
        token_configured = true,
        updated_by_staff_id = excluded.updated_by_staff_id,
        updated_at = now();

  insert into public.line_official_account_secrets (
    organization_id,
    channel_secret_cipher,
    channel_access_token_cipher,
    key_id,
    updated_at
  ) values (
    p_organization_id,
    p_channel_secret_cipher,
    p_channel_access_token_cipher,
    p_key_id,
    now()
  )
  on conflict (organization_id) do update
    set channel_secret_cipher = excluded.channel_secret_cipher,
        channel_access_token_cipher = excluded.channel_access_token_cipher,
        key_id = excluded.key_id,
        updated_at = now();

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'secret_configured', true,
    'token_configured', true
  );
end;
$$;

comment on function public.upsert_line_official_account_connection(text, text, text, text, text, text) is
  'Owner-only persist of encrypted LINE credentials. Never returns plaintext or cipher columns.';

create or replace function public.set_line_broadcast_enabled(
  p_organization_id text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  insert into public.line_official_accounts (
    organization_id,
    broadcast_enabled,
    updated_by_staff_id,
    updated_at
  ) values (
    p_organization_id,
    coalesce(p_enabled, false),
    public.user_operational_staff_id(
      (select o.id from public.organizations o where o.app_id = p_organization_id)
    ),
    now()
  )
  on conflict (organization_id) do update
    set broadcast_enabled = excluded.broadcast_enabled,
        updated_by_staff_id = excluded.updated_by_staff_id,
        updated_at = now();

  perform public.insert_line_broadcast_event(
    p_organization_id,
    null,
    case when coalesce(p_enabled, false) then 'broadcast_enabled' else 'broadcast_disabled' end,
    case
      when coalesce(p_enabled, false) then 'owner enabled broadcast flag'
      else 'owner disabled broadcast flag'
    end
  );

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'broadcast_enabled', coalesce(p_enabled, false)
  );
end;
$$;

comment on function public.set_line_broadcast_enabled(text, boolean) is
  'Owner-only enable flag. Application send remains closed until LINE_BROADCAST_SEND_OPEN is true.';

create or replace function public.record_line_connection_test(
  p_organization_id text,
  p_status text,
  p_message text,
  p_bot_display_name text default null,
  p_bot_basic_id text default null
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
  if p_status is null or p_status not in ('ok', 'failed', 'not_configured') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  update public.line_official_accounts
  set last_tested_at = now(),
      last_test_status = p_status,
      last_test_message = p_message,
      bot_display_name = coalesce(p_bot_display_name, bot_display_name),
      bot_basic_id = coalesce(p_bot_basic_id, bot_basic_id),
      updated_at = now()
  where organization_id = p_organization_id;

  perform public.insert_line_broadcast_event(
    p_organization_id,
    null,
    'connection_tested',
    coalesce(p_message, p_status)
  );

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'last_test_status', p_status
  );
end;
$$;

create or replace function public.upsert_line_broadcast_draft(
  p_organization_id text,
  p_broadcast_id text,
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
  v_existing public.line_broadcasts%rowtype;
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

  if p_broadcast_id is not null and p_broadcast_id like 'lbr-%' then
    select * into v_existing
    from public.line_broadcasts
    where id = p_broadcast_id
    for update;
    if found then
      if v_existing.organization_id is distinct from p_organization_id then
        raise exception 'unauthorized' using errcode = '42501';
      end if;
      if v_existing.status is distinct from 'draft' then
        raise exception 'invalid broadcast' using errcode = '22023';
      end if;
      update public.line_broadcasts
      set text_body = p_text_body,
          updated_at = now()
      where id = v_existing.id;
      v_id := v_existing.id;
    end if;
  end if;

  if v_id is null then
    if p_request_id is null or p_request_id not like 'lbrq-%' then
      raise exception 'invalid request' using errcode = '22023';
    end if;
    select * into v_existing
    from public.line_broadcasts
    where organization_id = p_organization_id
      and request_id = p_request_id
    for update;
    if found then
      if v_existing.status is distinct from 'draft' then
        return jsonb_build_object(
          'broadcast_id', v_existing.id,
          'request_id', v_existing.request_id,
          'status', v_existing.status,
          'reused', true
        );
      end if;
      update public.line_broadcasts
      set text_body = p_text_body,
          updated_at = now()
      where id = v_existing.id;
      v_id := v_existing.id;
    else
      v_id := 'lbr-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
      insert into public.line_broadcasts (
        id,
        organization_id,
        status,
        text_body,
        request_id,
        created_by_staff_id
      ) values (
        v_id,
        p_organization_id,
        'draft',
        p_text_body,
        p_request_id,
        v_actor.user_id
      );
    end if;
  end if;

  perform public.insert_line_broadcast_event(
    p_organization_id,
    v_id,
    'draft_saved',
    left(p_text_body, 80)
  );

  return jsonb_build_object(
    'broadcast_id', v_id,
    'request_id', coalesce(p_request_id, v_existing.request_id),
    'status', 'draft',
    'reused', false
  );
end;
$$;

comment on function public.upsert_line_broadcast_draft(text, text, text, text) is
  'Owner-only persist-first draft. Reuses request_id. Does not call LINE.';

create or replace function public.mark_line_broadcast_send_closed(
  p_organization_id text,
  p_broadcast_id text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.line_broadcasts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_row
  from public.line_broadcasts
  where id = p_broadcast_id
    and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'invalid broadcast' using errcode = '22023';
  end if;
  if v_row.request_id is distinct from p_request_id then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  if v_row.status in ('accepted', 'sending', 'pending_confirmation') then
    return jsonb_build_object(
      'broadcast_id', v_row.id,
      'status', v_row.status,
      'api_result', v_row.api_result
    );
  end if;

  update public.line_broadcasts
  set status = 'send_closed',
      api_result = 'send_closed',
      confirmed_by_staff_id = public.user_operational_staff_id(
        (select o.id from public.organizations o where o.app_id = p_organization_id)
      ),
      confirmed_at = now(),
      updated_at = now()
  where id = v_row.id;

  perform public.insert_line_broadcast_event(
    p_organization_id,
    v_row.id,
    'send_closed',
    'phase 1 send closed; no LINE broadcast HTTP'
  );

  return jsonb_build_object(
    'broadcast_id', v_row.id,
    'status', 'send_closed',
    'api_result', 'send_closed'
  );
end;
$$;

create or replace function public.read_line_official_account_secrets(
  p_organization_id text
)
returns table (
  channel_secret_cipher text,
  channel_access_token_cipher text,
  key_id text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Intentionally not granted to authenticated/anon. Server/service_role only.
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return query
  select
    s.channel_secret_cipher,
    s.channel_access_token_cipher,
    s.key_id
  from public.line_official_account_secrets s
  where s.organization_id = p_organization_id;
end;
$$;

comment on function public.read_line_official_account_secrets(text) is
  'Server/service_role only. Never grant to authenticated. Returns ciphertext, never plaintext.';

revoke all on function public.upsert_line_official_account_connection(text, text, text, text, text, text)
  from public, anon;
grant execute on function public.upsert_line_official_account_connection(text, text, text, text, text, text)
  to authenticated;
revoke all on function public.set_line_broadcast_enabled(text, boolean) from public, anon;
grant execute on function public.set_line_broadcast_enabled(text, boolean) to authenticated;
revoke all on function public.record_line_connection_test(text, text, text, text, text)
  from public, anon;
grant execute on function public.record_line_connection_test(text, text, text, text, text)
  to authenticated;
revoke all on function public.upsert_line_broadcast_draft(text, text, text, text)
  from public, anon;
grant execute on function public.upsert_line_broadcast_draft(text, text, text, text)
  to authenticated;
revoke all on function public.mark_line_broadcast_send_closed(text, text, text)
  from public, anon;
grant execute on function public.mark_line_broadcast_send_closed(text, text, text)
  to authenticated;
revoke all on function public.read_line_official_account_secrets(text)
  from public, anon, authenticated;
