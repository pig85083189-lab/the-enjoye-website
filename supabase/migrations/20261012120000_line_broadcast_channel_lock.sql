-- Preview-only Channel-level Broadcast lock + cross-org daily count.
-- Additive. Default closed. Does not open send. Does not rewrite Broadcast rows.
-- Channel lock covers formal and oneshot. Lock is not LINE monthly quota confirmation.
-- Do not apply on Production. No top-level BEGIN/COMMIT so a wrapper transaction can apply it.

alter table public.line_official_accounts
  add column if not exists broadcast_formal_runtime_open boolean not null default false;

comment on column public.line_official_accounts.broadcast_formal_runtime_open is
  'Preview-only formal Broadcast runtime gate. Default false. Fail-closed. org-beauty-os-test may not open. Opening this is not a LINE monthly quota confirmation.';

create index if not exists line_official_accounts_channel_id_idx
  on public.line_official_accounts (channel_id)
  where channel_id is not null;

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
      'bind_attempt_limited',
      'test_push_runtime_opened',
      'test_push_runtime_closed',
      'broadcast_test_runtime_opened',
      'broadcast_test_runtime_closed',
      'broadcast_oneshot_consumed',
      'broadcast_formal_runtime_opened',
      'broadcast_formal_runtime_closed'
    )
  );

create or replace function public.line_broadcast_consumed_on_taipei_day_for_channel(
  p_channel_id text,
  p_at timestamptz default now()
)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.line_broadcasts s
  join public.line_official_accounts a
    on a.organization_id = s.organization_id
  where p_channel_id is not null
    and a.channel_id = p_channel_id
    and (
      (
        s.send_claimed_at is not null
        and (s.send_claimed_at at time zone 'Asia/Taipei')::date
          = (p_at at time zone 'Asia/Taipei')::date
      )
      or (
        s.send_claimed_at is null
        and s.status in ('accepted', 'sending', 'pending_confirmation')
        and (coalesce(s.confirmed_at, s.created_at) at time zone 'Asia/Taipei')::date
          = (p_at at time zone 'Asia/Taipei')::date
      )
    );
$$;

comment on function public.line_broadcast_consumed_on_taipei_day_for_channel(text, timestamptz) is
  'Counts Broadcast claims for every Organization that shares the LINE Channel on the Asia/Taipei calendar day. Accepted history with send_claimed_at counts. Organization daily limit is not LINE monthly quota.';

revoke all on function public.line_broadcast_consumed_on_taipei_day_for_channel(text, timestamptz)
  from public, anon, authenticated;

create or replace function public.line_broadcast_channel_has_inflight(
  p_channel_id text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.line_broadcasts s
    join public.line_official_accounts a
      on a.organization_id = s.organization_id
    where p_channel_id is not null
      and a.channel_id = p_channel_id
      and s.status in ('sending', 'pending_confirmation')
  );
$$;

comment on function public.line_broadcast_channel_has_inflight(text) is
  'True when any Organization on this LINE Channel has sending or pending_confirmation. accepted is not inflight.';

revoke all on function public.line_broadcast_channel_has_inflight(text)
  from public, anon, authenticated;

create or replace function public.read_line_broadcast_channel_usage(
  p_organization_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel_id text;
  v_org_consumed integer := 0;
  v_channel_consumed integer := 0;
  v_inflight boolean := false;
  v_peers text[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select a.channel_id
    into v_channel_id
  from public.line_official_accounts a
  where a.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object(
      'ok', false,
      'reason', 'not_configured',
      'quota_confirmed', false
    );
  end if;

  v_org_consumed := public.line_broadcast_consumed_on_taipei_day(p_organization_id);
  if v_channel_id is not null then
    v_channel_consumed := public.line_broadcast_consumed_on_taipei_day_for_channel(v_channel_id);
    v_inflight := public.line_broadcast_channel_has_inflight(v_channel_id);
    select coalesce(array_agg(a.organization_id order by a.organization_id), '{}')
      into v_peers
    from public.line_official_accounts a
    where a.channel_id = v_channel_id
      and a.organization_id is distinct from p_organization_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'channel_id', v_channel_id,
    'organization_id', p_organization_id,
    'consumed_today', v_channel_consumed,
    'org_consumed_today', v_org_consumed,
    'peer_consumed_today', greatest(v_channel_consumed - v_org_consumed, 0),
    'inflight', v_inflight,
    'peer_organization_ids', to_jsonb(v_peers),
    'quota_confirmed', false
  );
end;
$$;

comment on function public.read_line_broadcast_channel_usage(text) is
  'Owner read of same-Channel Broadcast usage. No message bodies, request ids, or secrets. quota_confirmed is always false: this read is not a LINE monthly quota confirmation.';

revoke all on function public.read_line_broadcast_channel_usage(text)
  from public, anon;
grant execute on function public.read_line_broadcast_channel_usage(text)
  to authenticated;

create or replace function public.set_line_broadcast_formal_runtime_open(
  p_organization_id text,
  p_open boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_org text;
  v_open boolean := coalesce(p_open, false);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_open and p_organization_id is not distinct from 'org-beauty-os-test' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'send_closed',
      'message', 'Beauty OS TEST 不能開啟正式群發執行開關'
    );
  end if;

  select a.organization_id
    into v_lock_org
  from public.line_official_accounts a
  where a.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not configured' using errcode = '22023';
  end if;

  update public.line_official_accounts
  set broadcast_formal_runtime_open = v_open,
      updated_at = now()
  where organization_id = p_organization_id;
  if not found then
    raise exception 'not configured' using errcode = '22023';
  end if;

  perform public.insert_line_broadcast_event(
    p_organization_id,
    null,
    case
      when v_open then 'broadcast_formal_runtime_opened'
      else 'broadcast_formal_runtime_closed'
    end,
    'broadcast formal runtime gate'
  );
  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'broadcast_formal_runtime_open', v_open
  );
end;
$$;

comment on function public.set_line_broadcast_formal_runtime_open(text, boolean) is
  'Owner Preview-only formal Broadcast runtime gate. Default closed. org-beauty-os-test may not open. Does not confirm LINE monthly quota and does not call LINE.';

revoke all on function public.set_line_broadcast_formal_runtime_open(text, boolean)
  from public, anon;
grant execute on function public.set_line_broadcast_formal_runtime_open(text, boolean)
  to authenticated;

create or replace function public.finalize_stale_line_broadcast_sending_for_channel(
  p_organization_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel_id text;
  v_lock_org text;
  v_row public.line_broadcasts%rowtype;
  v_claimed_at timestamptz;
  v_ids text[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select a.channel_id
    into v_channel_id
  from public.line_official_accounts a
  where a.organization_id = p_organization_id;
  if not found or v_channel_id is null or btrim(v_channel_id) = '' then
    return jsonb_build_object(
      'ok', true,
      'finalized_count', 0,
      'broadcast_ids', '[]'::jsonb
    );
  end if;

  perform pg_advisory_xact_lock(870121, hashtext(v_channel_id));

  for v_lock_org in
    select a.organization_id
    from public.line_official_accounts a
    where a.channel_id = v_channel_id
    order by a.organization_id
    for update
  loop
    null;
  end loop;

  for v_row in
    select s.*
    from public.line_broadcasts s
    join public.line_official_accounts a
      on a.organization_id = s.organization_id
    where a.channel_id = v_channel_id
      and s.status = 'sending'
    order by s.organization_id, s.id
    for update of s
  loop
    v_claimed_at := coalesce(v_row.send_claimed_at, v_row.confirmed_at, v_row.updated_at);
    if v_claimed_at >= now() - interval '30 seconds' then
      continue;
    end if;

    update public.line_broadcasts
    set status = 'pending_confirmation',
        api_result = 'pending_confirmation',
        error_message = '發送中斷，系統已標記待確認，不會自動重送',
        error_class = 'unknown',
        updated_at = now()
    where id = v_row.id
      and organization_id = v_row.organization_id
      and status = 'sending';

    if found then
      v_ids := array_append(v_ids, v_row.id);
      perform public.insert_line_broadcast_event(
        v_row.organization_id,
        v_row.id,
        'pending_confirmation',
        '發送中斷，系統已標記待確認，不會自動重送'
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'finalized_count', coalesce(cardinality(v_ids), 0),
    'broadcast_ids', to_jsonb(v_ids)
  );
end;
$$;

comment on function public.finalize_stale_line_broadcast_sending_for_channel(text) is
  'Owner of any Organization on a LINE Channel may close sibling stale sending older than 30s to pending_confirmation. Same Channel lock order as claim. Does not change send_claimed_at, accepted, or pending_confirmation. Never calls LINE. Never retries. Returns ids only, never message bodies.';

revoke all on function public.finalize_stale_line_broadcast_sending_for_channel(text)
  from public, anon;
grant execute on function public.finalize_stale_line_broadcast_sending_for_channel(text)
  to authenticated;

drop function if exists public.claim_line_broadcast_send(text, text, text, text);
drop function if exists public.claim_line_broadcast_send(text, text, text, text, text, boolean, integer, timestamptz);

create or replace function public.claim_line_broadcast_send(
  p_organization_id text,
  p_broadcast_id text,
  p_request_id text,
  p_text_body text,
  p_send_mode text default 'oneshot',
  p_quota_known boolean default false,
  p_quota_remaining integer default null,
  p_quota_checked_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.staff_auth_memberships%rowtype;
  v_row public.line_broadcasts%rowtype;
  v_lock_org text;
  v_channel_id text;
  v_channel_before text;
  v_bot_name text;
  v_bot_basic text;
  v_runtime_open boolean := false;
  v_broadcast_enabled boolean := false;
  v_formal_runtime_open boolean := false;
  v_permit_id text;
  v_consumed_today integer := 0;
  v_channel_consumed integer := 0;
  v_send_mode text := lower(btrim(coalesce(p_send_mode, 'oneshot')));
  v_quota_confirmed boolean := false;
  v_expected_sha text := '68ca91c946ed5b09a90884943fc96c653e7b5ad05d55dcdd7dece071e4a6315e';
  v_expected_text text := E'【LINE 群發功能測試】\n這是一則系統功能測試訊息，無需回覆，謝謝。';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_request_id is null or p_request_id not like 'lbrq-%' then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  if p_text_body is null or length(btrim(p_text_body)) = 0 or length(p_text_body) > 5000 then
    raise exception 'invalid text' using errcode = '22023';
  end if;
  if v_send_mode not in ('oneshot', 'formal') then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'invalid_input',
      'quota_confirmed', false,
      'message', '發送模式不正確'
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
  if not public.is_operational_staff_id(v_actor.user_id) then
    raise exception 'invalid actor' using errcode = '42501';
  end if;

  -- Resolve Channel first. Do not hold a singleton org lock before the
  -- Channel set, or two shared-Channel Organizations can deadlock.
  select a.channel_id
    into v_channel_before
  from public.line_official_accounts a
  where a.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'not_configured',
      'quota_confirmed', false,
      'message', '請先完成 LINE 官方帳號連線測試'
    );
  end if;

  -- Channel send lock. Acquiring this lock is not a LINE monthly quota confirmation.
  if v_channel_before is not null then
    perform pg_advisory_xact_lock(870121, hashtext(v_channel_before));
  end if;

  for v_lock_org in
    select a.organization_id
    from public.line_official_accounts a
    where a.organization_id = p_organization_id
       or (
         v_channel_before is not null
         and a.channel_id = v_channel_before
       )
    order by a.organization_id
    for update
  loop
    null;
  end loop;

  select
      a.organization_id,
      a.channel_id,
      a.bot_display_name,
      a.bot_basic_id,
      a.broadcast_test_runtime_open,
      a.broadcast_enabled,
      a.broadcast_formal_runtime_open
    into
      v_lock_org,
      v_channel_id,
      v_bot_name,
      v_bot_basic,
      v_runtime_open,
      v_broadcast_enabled,
      v_formal_runtime_open
  from public.line_official_accounts a
  where a.organization_id = p_organization_id;
  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'not_configured',
      'quota_confirmed', false,
      'message', '請先完成 LINE 官方帳號連線測試'
    );
  end if;
  if v_channel_id is distinct from v_channel_before then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'quota_confirmed', false,
      'message', 'LINE Channel 已變更，已停止發送'
    );
  end if;
  if v_channel_id is null or btrim(v_channel_id) = '' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'not_configured',
      'quota_confirmed', false,
      'message', '請先完成 LINE 官方帳號連線測試'
    );
  end if;

  if v_send_mode = 'oneshot' then
    if p_organization_id is distinct from 'org-beauty-os-test' then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'send_closed',
        'quota_confirmed', false,
        'message', '一次性群發測試只允許 Beauty OS TEST'
      );
    end if;
    if coalesce(v_runtime_open, false) is not true then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'send_closed',
        'quota_confirmed', false,
        'message', '一次性群發測試總開關已關閉'
      );
    end if;
    if v_channel_id is distinct from '2009219238' then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'send_closed',
        'quota_confirmed', false,
        'message', 'Channel ID 與授權測試帳號不一致'
      );
    end if;
    if v_bot_name is distinct from 'ai' or v_bot_basic is distinct from '@357gospk' then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'send_closed',
        'quota_confirmed', false,
        'message', '官方帳號與授權測試帳號不一致'
      );
    end if;
    if p_text_body is distinct from v_expected_text
       or encode(sha256(convert_to(p_text_body, 'UTF8')), 'hex') is distinct from v_expected_sha
    then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'invalid_input',
        'quota_confirmed', false,
        'message', '訊息必須與指定測試全文完全一致'
      );
    end if;

    select p.id
      into v_permit_id
    from public.line_broadcast_oneshot_permits p
    where p.organization_id = p_organization_id
      and p.consumed_at is null
      and p.channel_id = '2009219238'
      and p.message_sha256 = v_expected_sha
    for update;
    if not found then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'send_closed',
        'quota_confirmed', false,
        'message', '沒有可用的一次性群發許可'
      );
    end if;
  else
    if p_organization_id is not distinct from 'org-beauty-os-test' then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'send_closed',
        'quota_confirmed', false,
        'message', 'Beauty OS TEST 只能使用一次性測試路徑，不能走正式群發'
      );
    end if;
    if coalesce(v_broadcast_enabled, false) is not true then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'send_closed',
        'quota_confirmed', false,
        'message', '店長尚未啟用 LINE 群發'
      );
    end if;
    if coalesce(v_formal_runtime_open, false) is not true then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'send_closed',
        'quota_confirmed', false,
        'message', '正式群發執行開關已關閉'
      );
    end if;
  end if;

  if p_broadcast_id is not null and p_broadcast_id like 'lbr-%' then
    select * into v_row
    from public.line_broadcasts
    where id = p_broadcast_id
      and organization_id = p_organization_id
    for update;
  end if;

  if v_row.id is null then
    select * into v_row
    from public.line_broadcasts
    where organization_id = p_organization_id
      and request_id = p_request_id
    for update;
  end if;

  if v_row.id is null then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'invalid_input',
      'quota_confirmed', false,
      'message', '找不到可發送的草稿'
    );
  end if;

  if v_row.organization_id is distinct from p_organization_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_row.request_id is distinct from p_request_id then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'invalid_input',
      'quota_confirmed', false,
      'message', '發送識別不一致'
    );
  end if;

  if v_row.status = 'accepted' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'duplicate',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', v_row.status,
      'quota_confirmed', false,
      'message', '這則訊息已經被 LINE API 接受，不會重送'
    );
  end if;
  if v_row.status = 'failed' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'duplicate',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', v_row.status,
      'quota_confirmed', false,
      'message', '這則識別已使用過，不會重送。請用新的 requestId'
    );
  end if;
  if v_row.status in ('pending_confirmation', 'sending') then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'pending_confirmation',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', v_row.status,
      'quota_confirmed', false,
      'message', '上一則發送結果待確認，系統不會自動重送'
    );
  end if;
  if v_row.status not in ('draft', 'confirm_pending', 'queued') then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', v_row.status,
      'quota_confirmed', false,
      'message', '這則紀錄不能再發送'
    );
  end if;
  if v_row.send_claimed_at is not null then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'duplicate',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', v_row.status,
      'quota_confirmed', false,
      'message', '這則識別已使用過，不會重送。請用新的 requestId'
    );
  end if;

  if public.line_broadcast_channel_has_inflight(v_channel_id) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'pending_confirmation',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'quota_confirmed', false,
      'message', '同一官方帳號有發送進行中或待確認，系統不會自動重送'
    );
  end if;

  v_channel_consumed := public.line_broadcast_consumed_on_taipei_day_for_channel(v_channel_id);
  if v_channel_consumed >= 3 then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'quota_exceeded',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'quota_confirmed', false,
      'message', '同一官方帳號今日群發次數已達上限'
    );
  end if;

  v_consumed_today := public.line_broadcast_consumed_on_taipei_day(p_organization_id);
  if v_consumed_today >= 3 then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'quota_exceeded',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'quota_confirmed', false,
      'message', '今日群發次數已達上限'
    );
  end if;

  -- Client-supplied p_quota_* is an untrusted fail-closed hint only.
  -- It is never LINE official remaining and never Channel / Organization daily usage.
  -- 4-arg oneshot calls omit the snapshot and must fail-closed.
  -- SQL cannot call LINE, so quota_confirmed stays false even when the gates pass.
  if coalesce(p_quota_known, false) is not true
     or p_quota_checked_at is null
     or p_quota_checked_at < (now() - interval '30 seconds')
     or p_quota_checked_at > (now() + interval '5 seconds')
  then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'quota_exceeded',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'quota_confirmed', false,
      'message', '無法確認 LINE 額度，已停止發送'
    );
  end if;
  if p_quota_remaining is not null and p_quota_remaining <= 0 then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'quota_exceeded',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'quota_confirmed', false,
      'message', 'LINE 訊息額度不足，已停止發送'
    );
  end if;

  update public.line_broadcasts
  set status = 'sending',
      text_body = p_text_body,
      confirmed_by_staff_id = v_actor.user_id,
      confirmed_at = now(),
      send_claimed_at = coalesce(send_claimed_at, now()),
      updated_at = now(),
      error_message = null
  where id = v_row.id
    and organization_id = p_organization_id
    and request_id = p_request_id
    and status = v_row.status
    and send_claimed_at is null;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'pending_confirmation',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', 'sending',
      'quota_confirmed', false,
      'message', '發送進行中，請勿重複送出'
    );
  end if;

  if v_send_mode = 'oneshot' then
    update public.line_broadcast_oneshot_permits
    set consumed_at = now(),
        consumed_broadcast_id = v_row.id
    where id = v_permit_id
      and organization_id = p_organization_id
      and consumed_at is null;

    if not found then
      raise exception 'oneshot permit already consumed'
        using errcode = '40001';
    end if;

    perform public.insert_line_broadcast_event(
      p_organization_id,
      v_row.id,
      'broadcast_oneshot_consumed',
      left(v_permit_id, 80)
    );
  end if;

  perform public.insert_line_broadcast_event(
    p_organization_id,
    v_row.id,
    'send_claimed',
    left(p_request_id, 80)
  );

  return jsonb_build_object(
    'claimed', true,
    'broadcast_id', v_row.id,
    'request_id', v_row.request_id,
    'status', 'sending',
    'send_mode', v_send_mode,
    'oneshot_consumed', v_send_mode = 'oneshot',
    'quota_confirmed', v_quota_confirmed
  );
end;
$$;

comment on function public.claim_line_broadcast_send(text, text, text, text, text, boolean, integer, timestamptz) is
  'Owner Channel-level FOR UPDATE claim. Locks every Organization that shares the LINE Channel, then checks inflight and Channel daily. Client p_quota_* is an untrusted fail-closed hint, never LINE official remaining and never Channel daily. 4-arg oneshot stays callable and fail-closed without a fresh snapshot. quota_confirmed stays false. Formal never consumes the oneshot permit. Never calls LINE. Does not rewrite accepted history.';

revoke all on function public.claim_line_broadcast_send(text, text, text, text, text, boolean, integer, timestamptz)
  from public, anon;
grant execute on function public.claim_line_broadcast_send(text, text, text, text, text, boolean, integer, timestamptz)
  to authenticated;
