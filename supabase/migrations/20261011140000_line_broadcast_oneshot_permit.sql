-- Preview-only one-shot Broadcast permit + runtime gate.
-- Default closed. Does not insert a usable permit. Does not open send.
-- Only org-beauty-os-test may open the runtime gate or hold a permit.
-- Does not rewrite existing Broadcast rows. Do not apply on Production.
-- No top-level BEGIN/COMMIT so a wrapper transaction can apply it.

alter table public.line_official_accounts
  add column if not exists broadcast_test_runtime_open boolean not null default false;

comment on column public.line_official_accounts.broadcast_test_runtime_open is
  'Preview-only Broadcast one-shot runtime gate. Default false. Fail-closed. Only org-beauty-os-test may be opened.';

create table if not exists public.line_broadcast_oneshot_permits (
  id text primary key,
  organization_id text not null
    references public.line_official_accounts (organization_id) on delete cascade,
  channel_id text not null,
  bot_display_name text not null,
  bot_basic_id text not null,
  message_sha256 text not null,
  consumed_at timestamptz,
  consumed_broadcast_id text,
  created_at timestamptz not null default now(),
  constraint line_broadcast_oneshot_permits_id_prefix
    check (id like 'lbrp-%'),
  constraint line_broadcast_oneshot_permits_test_org
    check (organization_id = 'org-beauty-os-test'),
  constraint line_broadcast_oneshot_permits_channel
    check (channel_id = '2009219238'),
  constraint line_broadcast_oneshot_permits_bot_name
    check (bot_display_name = 'ai'),
  constraint line_broadcast_oneshot_permits_bot_basic
    check (bot_basic_id = '@357gospk'),
  constraint line_broadcast_oneshot_permits_sha
    check (message_sha256 ~ '^[0-9a-f]{64}$'),
  constraint line_broadcast_oneshot_permits_expected_text
    check (
      message_sha256 = '68ca91c946ed5b09a90884943fc96c653e7b5ad05d55dcdd7dece071e4a6315e'
    )
);

comment on table public.line_broadcast_oneshot_permits is
  'Preview-only one-shot Broadcast permit. Migration never inserts a row. Successful claim consumes the unused row in the same transaction.';

create unique index if not exists line_broadcast_oneshot_one_open
  on public.line_broadcast_oneshot_permits (organization_id)
  where consumed_at is null;

alter table public.line_broadcast_oneshot_permits enable row level security;

revoke all on public.line_broadcast_oneshot_permits from anon, authenticated, public;
grant select on public.line_broadcast_oneshot_permits to authenticated;

drop policy if exists line_broadcast_oneshot_permits_select_owner
  on public.line_broadcast_oneshot_permits;
create policy line_broadcast_oneshot_permits_select_owner
on public.line_broadcast_oneshot_permits
for select
to authenticated
using (
  public.user_is_org_owner(organization_id)
  and organization_id = 'org-beauty-os-test'
);

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
      'broadcast_oneshot_consumed'
    )
  );

create or replace function public.set_line_broadcast_test_runtime_open(
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
  if v_open and p_organization_id is distinct from 'org-beauty-os-test' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'send_closed',
      'message', '一次性群發測試總開關只能在 Beauty OS TEST 開啟'
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
  set broadcast_test_runtime_open = v_open,
      updated_at = now()
  where organization_id = p_organization_id;
  if not found then
    raise exception 'not configured' using errcode = '22023';
  end if;

  perform public.insert_line_broadcast_event(
    p_organization_id,
    null,
    case
      when v_open then 'broadcast_test_runtime_opened'
      else 'broadcast_test_runtime_closed'
    end,
    'broadcast oneshot runtime gate'
  );
  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'broadcast_test_runtime_open', v_open
  );
end;
$$;

comment on function public.set_line_broadcast_test_runtime_open(text, boolean) is
  'Owner Preview-only Broadcast one-shot runtime gate. Same org row lock as claim. Only org-beauty-os-test may open. Default closed. Does not insert a permit or call LINE.';

revoke all on function public.set_line_broadcast_test_runtime_open(text, boolean)
  from public, anon;
grant execute on function public.set_line_broadcast_test_runtime_open(text, boolean)
  to authenticated;

create or replace function public.claim_line_broadcast_send(
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
  v_row public.line_broadcasts%rowtype;
  v_lock_org text;
  v_channel_id text;
  v_bot_name text;
  v_bot_basic text;
  v_runtime_open boolean := false;
  v_permit_id text;
  v_consumed_today integer := 0;
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

  -- Serialize every Broadcast claim for this org before counting or updating.
  select
      a.organization_id,
      a.channel_id,
      a.bot_display_name,
      a.bot_basic_id,
      a.broadcast_test_runtime_open
    into v_lock_org, v_channel_id, v_bot_name, v_bot_basic, v_runtime_open
  from public.line_official_accounts a
  where a.organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'not_configured',
      'message', '請先完成 LINE 官方帳號連線測試'
    );
  end if;

  if p_organization_id is distinct from 'org-beauty-os-test' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'message', '一次性群發測試只允許 Beauty OS TEST'
    );
  end if;
  if coalesce(v_runtime_open, false) is not true then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'message', '一次性群發測試總開關已關閉'
    );
  end if;
  if v_channel_id is distinct from '2009219238' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'message', 'Channel ID 與授權測試帳號不一致'
    );
  end if;
  if v_bot_name is distinct from 'ai' or v_bot_basic is distinct from '@357gospk' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'message', '官方帳號與授權測試帳號不一致'
    );
  end if;
  if p_text_body is distinct from v_expected_text
     or encode(sha256(convert_to(p_text_body, 'UTF8')), 'hex') is distinct from v_expected_sha
  then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'invalid_input',
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
      'message', '沒有可用的一次性群發許可'
    );
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
      'message', '這則識別已使用過，不會重送。請用新的 requestId'
    );
  end if;

  v_consumed_today := public.line_broadcast_consumed_on_taipei_day(p_organization_id);
  if v_consumed_today >= 3 then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'quota_exceeded',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'message', '今日群發次數已達上限'
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
      'message', '發送進行中，請勿重複送出'
    );
  end if;

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
    'send_claimed',
    left(p_request_id, 80)
  );
  perform public.insert_line_broadcast_event(
    p_organization_id,
    v_row.id,
    'broadcast_oneshot_consumed',
    left(v_permit_id, 80)
  );

  return jsonb_build_object(
    'claimed', true,
    'broadcast_id', v_row.id,
    'request_id', v_row.request_id,
    'status', 'sending',
    'oneshot_consumed', true
  );
end;
$$;

comment on function public.claim_line_broadcast_send(text, text, text, text) is
  'Owner + org-scoped FOR UPDATE claim. Preview one-shot path consumes the unused permit in the same transaction after a successful claim stamp. Other organizations are refused. Never calls LINE.';

revoke all on function public.claim_line_broadcast_send(text, text, text, text)
  from public, anon;
grant execute on function public.claim_line_broadcast_send(text, text, text, text)
  to authenticated;
