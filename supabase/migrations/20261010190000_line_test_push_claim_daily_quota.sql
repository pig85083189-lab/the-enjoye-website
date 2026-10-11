-- Preview-safe additive repair for claim_line_test_send.
-- Serializes per-organization claims and counts today's consumed test
-- sends in the same transaction as the atomic status='sending' update.
-- Does not rewrite 120000 / 140000 / 160000 / 180000.
-- Does not open send switches. Does not touch THE ENJOYE operational rows.

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

  -- Serialize all test-push claims for this org before counting or updating.
  select a.organization_id
    into v_lock_org
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
  'Owner + org-scoped FOR UPDATE claim. Daily accepted/sending/pending_confirmation count lives in the same transaction. Timeout stays pending_confirmation. No retry.';

revoke all on function public.claim_line_test_send(text, text, text, text) from public, anon;
grant execute on function public.claim_line_test_send(text, text, text, text) to authenticated;
