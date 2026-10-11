-- =============================================================================
-- Beauty OS — LINE broadcast real-send claim (Phase 1B)
-- Additive. Reuses line_broadcasts / line_broadcast_events.
-- Actual HTTP stays application-closed until LINE_BROADCAST_SEND_OPEN is true.
-- Does not rewrite 20261010120000. Does not invent friend counts.
-- =============================================================================

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
      'send_refused'
    )
  );

create or replace function public.record_line_broadcast_owner_event(
  p_organization_id text,
  p_broadcast_id text,
  p_event_type text,
  p_detail text
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
  if p_event_type is null or p_event_type not in ('send_refused', 'confirm_refused') then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  if p_broadcast_id is not null and p_broadcast_id not like 'lbr-%' then
    raise exception 'invalid broadcast' using errcode = '22023';
  end if;

  perform public.insert_line_broadcast_event(
    p_organization_id,
    p_broadcast_id,
    p_event_type,
    left(coalesce(p_detail, ''), 200)
  );

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'broadcast_id', p_broadcast_id,
    'event_type', p_event_type
  );
end;
$$;

comment on function public.record_line_broadcast_owner_event(text, text, text, text) is
  'Owner-only LINE audit for refused send/confirm. Never stores tokens.';

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

  if p_broadcast_id is not null and p_broadcast_id like 'lbr-%' then
    select * into v_row
    from public.line_broadcasts
    where id = p_broadcast_id
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
  if v_row.status = 'pending_confirmation' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'pending_confirmation',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', v_row.status,
      'message', '上一則發送結果待確認，系統不會自動重送'
    );
  end if;
  if v_row.status = 'sending' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'pending_confirmation',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', v_row.status,
      'message', '發送進行中，請勿重複送出'
    );
  end if;
  if v_row.status not in ('draft', 'confirm_pending', 'failed', 'queued') then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'send_closed',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', v_row.status,
      'message', '這則紀錄不能再發送'
    );
  end if;

  update public.line_broadcasts
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
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', 'sending',
      'message', '發送進行中，請勿重複送出'
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
    'status', 'sending'
  );
end;
$$;

comment on function public.claim_line_broadcast_send(text, text, text, text) is
  'Atomic Owner claim. One request_id can leave draft only once. Never calls LINE.';

create or replace function public.complete_line_broadcast_send(
  p_organization_id text,
  p_broadcast_id text,
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
  v_row public.line_broadcasts%rowtype;
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
  if p_api_result is null or p_api_result not in (
    'accepted', 'failed', 'pending_confirmation', 'send_closed'
  ) then
    raise exception 'invalid result' using errcode = '22023';
  end if;

  select * into v_row
  from public.line_broadcasts
  where id = p_broadcast_id
    and organization_id = p_organization_id
    and request_id = p_request_id
  for update;
  if not found then
    raise exception 'invalid broadcast' using errcode = '22023';
  end if;

  if v_row.status in ('accepted', 'pending_confirmation') then
    return jsonb_build_object(
      'broadcast_id', v_row.id,
      'status', v_row.status,
      'api_result', v_row.api_result,
      'completed', false
    );
  end if;
  if v_row.status is distinct from 'sending' then
    return jsonb_build_object(
      'broadcast_id', v_row.id,
      'status', v_row.status,
      'api_result', v_row.api_result,
      'completed', false
    );
  end if;

  update public.line_broadcasts
  set status = p_status,
      api_result = p_api_result,
      line_request_id = coalesce(nullif(p_line_request_id, ''), line_request_id),
      error_message = nullif(p_error_message, ''),
      updated_at = now()
  where id = v_row.id;

  v_event := case p_status
    when 'accepted' then 'api_accepted'
    when 'pending_confirmation' then 'pending_confirmation'
    when 'send_closed' then 'send_closed'
    else 'api_failed'
  end;

  perform public.insert_line_broadcast_event(
    p_organization_id,
    v_row.id,
    v_event,
    left(coalesce(p_error_message, p_api_result, p_status), 200)
  );

  return jsonb_build_object(
    'broadcast_id', v_row.id,
    'status', p_status,
    'api_result', p_api_result,
    'completed', true
  );
end;
$$;

comment on function public.complete_line_broadcast_send(text, text, text, text, text, text, text) is
  'Finish a claimed send exactly once. Timeout stays pending_confirmation. No retry.';

revoke all on function public.record_line_broadcast_owner_event(text, text, text, text)
  from public, anon;
grant execute on function public.record_line_broadcast_owner_event(text, text, text, text)
  to authenticated;
revoke all on function public.claim_line_broadcast_send(text, text, text, text)
  from public, anon;
grant execute on function public.claim_line_broadcast_send(text, text, text, text)
  to authenticated;
revoke all on function public.complete_line_broadcast_send(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.complete_line_broadcast_send(text, text, text, text, text, text, text)
  to authenticated;
