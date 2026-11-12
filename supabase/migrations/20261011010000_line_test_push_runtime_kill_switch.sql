-- Preview-safe additive repair for LINE test-push Phase 1D.1.
-- 1. claim_line_test_send refuses reuse of failed/accepted/pending/sending rows.
-- 2. Preview-only runtime kill switch on line_official_accounts, default false.
-- The switch is re-read under the same FOR UPDATE org lock as claim, so close
-- and claim cannot race. In-flight HTTP after claimed=true cannot be cancelled.
-- Does not rewrite 120000 / 140000 / 160000 / 180000 / 190000 / 200000.
-- Does not open send switches. Does not touch THE ENJOYE operational rows.
-- Do not apply on Production.

alter table public.line_official_accounts
  add column if not exists test_push_runtime_open boolean not null default false;

comment on column public.line_official_accounts.test_push_runtime_open is
  'Preview-only runtime kill switch. Default false. Fail-closed. Only org-beauty-os-test may be opened.';

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
      'test_push_runtime_closed'
    )
  );

create or replace function public.set_line_test_push_runtime_open(
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
      'message', '測試發送總開關只能在 Beauty OS TEST 開啟'
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
  set test_push_runtime_open = v_open,
      updated_at = now()
  where organization_id = p_organization_id;
  if not found then
    raise exception 'not configured' using errcode = '22023';
  end if;

  perform public.insert_line_broadcast_event(
    p_organization_id,
    null,
    case when v_open then 'test_push_runtime_opened' else 'test_push_runtime_closed' end,
    'runtime kill switch'
  );
  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'test_push_runtime_open', v_open
  );
end;
$$;

comment on function public.set_line_test_push_runtime_open(text, boolean) is
  'Owner runtime kill switch. Same org row lock as claim_line_test_send. Only org-beauty-os-test may open. Default closed. Does not cancel in-flight HTTP.';

revoke all on function public.set_line_test_push_runtime_open(text, boolean) from public, anon;
grant execute on function public.set_line_test_push_runtime_open(text, boolean) to authenticated;

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
  v_lock_org text;
  v_owner_enabled boolean := false;
  v_runtime_open boolean := false;
  v_consumed_today integer := 0;
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

  -- Serialize close + claim on the same org account row. Re-read the
  -- runtime switch under this lock; query miss is fail-closed.
  select a.organization_id, a.test_push_enabled, a.test_push_runtime_open
    into v_lock_org, v_owner_enabled, v_runtime_open
  from public.line_official_accounts a
  where a.organization_id = p_organization_id
  for update;
  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'message', '無法確認測試發送總開關，已拒絕發送'
    );
  end if;
  if p_organization_id is distinct from 'org-beauty-os-test' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'message', '測試發送僅允許 Beauty OS TEST'
    );
  end if;
  if coalesce(v_runtime_open, false) is not true then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'message', '測試發送總開關已關閉'
    );
  end if;
  if coalesce(v_owner_enabled, false) is not true then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'message', '店長尚未啟用測試發送'
    );
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
  if v_row.status in ('failed', 'send_closed', 'canceled') then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'duplicate',
      'message', '這則測試識別已使用過，不會重送。請用新的 requestId'
    );
  end if;
  if v_row.status not in ('draft', 'confirm_pending', 'queued') then
    return jsonb_build_object('claimed', false, 'reason', 'send_closed', 'message', '這則測試不能再發送');
  end if;

  select count(*)::integer
    into v_consumed_today
  from public.line_test_sends s
  where s.organization_id = p_organization_id
    and s.status in ('accepted', 'sending', 'pending_confirmation')
    and (s.created_at at time zone 'utc')::date = (timezone('utc', now()))::date;
  if v_consumed_today >= 3 then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'quota_exceeded',
      'message', '今日測試發送次數已達上限'
    );
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

comment on function public.claim_line_test_send(text, text, text, text) is
  'Owner + org-scoped FOR UPDATE claim. Refuses consumed requestId including failed. Runtime kill switch and Owner flag are re-read under the same lock. Daily quota stays in-transaction. Timeout stays pending_confirmation. No retry. In-flight HTTP after claimed=true cannot be cancelled.';

revoke all on function public.claim_line_test_send(text, text, text, text) from public, anon;
grant execute on function public.claim_line_test_send(text, text, text, text) to authenticated;
