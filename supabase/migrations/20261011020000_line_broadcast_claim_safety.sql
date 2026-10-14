-- =============================================================================
-- Beauty OS — LINE Broadcast claim safety (Phase 1F.2)
-- Additive. Does not rewrite 120000 / 140000 / 160000 / 180000 / 190000 / 200000 / 010000.
-- Does not fabricate historical send_claimed_at values.
-- Does not open send switches.
-- Does not store LINE response bodies, tokens, or other secrets.
-- Must run as a single transaction. Do not apply until review.
-- Do not apply on Production in this phase.
-- =============================================================================

alter table public.line_broadcasts
  add column if not exists http_status integer,
  add column if not exists error_class text,
  add column if not exists send_claimed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'line_broadcasts_http_status_check'
  ) then
    alter table public.line_broadcasts
      add constraint line_broadcasts_http_status_check
      check (http_status is null or (http_status >= 100 and http_status <= 599));
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'line_broadcasts_error_class_check'
  ) then
    alter table public.line_broadcasts
      add constraint line_broadcasts_error_class_check
      check (
        error_class is null
        or error_class in (
          'unauthorized',
          'forbidden',
          'invalid_request',
          'quota_exceeded',
          'timeout',
          'unknown'
        )
      );
  end if;
end
$$;

comment on column public.line_broadcasts.http_status is
  'LINE HTTP status from the Broadcast response. Never backfilled. Null on older rows.';
comment on column public.line_broadcasts.error_class is
  'Safe whitelist class from HTTP status / timeout only. Never stores LINE response body or secrets.';
comment on column public.line_broadcasts.send_claimed_at is
  'Immutable Taipei-quota timestamp set once on successful claim. Null on drafts and unrestored history. Never fabricated.';

create index if not exists line_broadcasts_org_send_claimed_at_idx
  on public.line_broadcasts (organization_id, send_claimed_at)
  where send_claimed_at is not null;

create or replace function public.protect_line_broadcast_send_claimed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.send_claimed_at is not null
    and new.send_claimed_at is distinct from old.send_claimed_at then
    new.send_claimed_at := old.send_claimed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists line_broadcasts_protect_send_claimed_at on public.line_broadcasts;
create trigger line_broadcasts_protect_send_claimed_at
before update on public.line_broadcasts
for each row
execute function public.protect_line_broadcast_send_claimed_at();

create or replace function public.line_broadcast_consumed_on_taipei_day(
  p_organization_id text,
  p_at timestamptz default now()
)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.line_broadcasts s
  where s.organization_id = p_organization_id
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

comment on function public.line_broadcast_consumed_on_taipei_day(text, timestamptz) is
  'Counts Broadcast claims for one Organization on the Asia/Taipei calendar day. New rows use immutable send_claimed_at regardless of later status. Legacy accepted/sending/pending_confirmation without send_claimed_at use confirmed_at, then created_at. Historical failed is not assumed to have sent and is not backfilled.';

revoke all on function public.line_broadcast_consumed_on_taipei_day(text, timestamptz)
  from public, anon, authenticated;

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
  v_consumed_today integer := 0;
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
  'Owner + org-scoped FOR UPDATE claim. One successful claim stamps immutable send_claimed_at and consumes the Asia/Taipei daily slot. Failed/accepted/pending/sending request ids cannot be reclaimed. Never calls LINE.';

create or replace function public.complete_line_broadcast_send(
  p_organization_id text,
  p_broadcast_id text,
  p_request_id text,
  p_status text,
  p_api_result text,
  p_line_request_id text,
  p_error_message text,
  p_http_status integer default null,
  p_error_class text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.line_broadcasts%rowtype;
  v_event text;
  v_error_class text;
  v_http_status integer;
  v_detail text;
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

  if p_error_class in (
    'unauthorized',
    'forbidden',
    'invalid_request',
    'quota_exceeded',
    'timeout',
    'unknown'
  ) then
    v_error_class := p_error_class;
  else
    v_error_class := null;
  end if;
  if p_http_status is not null and p_http_status >= 100 and p_http_status <= 599 then
    v_http_status := p_http_status;
  else
    v_http_status := null;
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
      http_status = v_http_status,
      error_class = v_error_class,
      updated_at = now()
  where id = v_row.id
    and organization_id = p_organization_id
    and request_id = p_request_id
    and status = 'sending';

  v_event := case p_status
    when 'accepted' then 'api_accepted'
    when 'pending_confirmation' then 'pending_confirmation'
    when 'send_closed' then 'send_closed'
    else 'api_failed'
  end;
  v_detail := left(
    concat_ws(
      ' ',
      nullif(p_error_message, ''),
      case when v_http_status is not null then 'http=' || v_http_status::text end,
      case when v_error_class is not null then 'class=' || v_error_class end
    ),
    200
  );

  perform public.insert_line_broadcast_event(
    p_organization_id,
    v_row.id,
    v_event,
    v_detail
  );

  return jsonb_build_object(
    'broadcast_id', v_row.id,
    'status', p_status,
    'api_result', p_api_result,
    'completed', true
  );
end;
$$;

comment on function public.complete_line_broadcast_send(text, text, text, text, text, text, text, integer, text) is
  'Finish a claimed send exactly once. Does not change send_claimed_at. Stores HTTP status and whitelist error class only. Timeout/5xx stay pending_confirmation. No retry.';

drop function if exists public.complete_line_broadcast_send(text, text, text, text, text, text, text);

create or replace function public.finalize_stale_line_broadcast_sending(
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
  v_claimed_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_broadcast_id is null or p_broadcast_id not like 'lbr-%' then
    raise exception 'invalid broadcast' using errcode = '22023';
  end if;
  if p_request_id is null or p_request_id not like 'lbrq-%' then
    raise exception 'invalid request' using errcode = '22023';
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

  if v_row.status is distinct from 'sending' then
    return jsonb_build_object(
      'broadcast_id', v_row.id,
      'status', v_row.status,
      'finalized', false
    );
  end if;

  v_claimed_at := coalesce(v_row.send_claimed_at, v_row.confirmed_at, v_row.updated_at);
  if v_claimed_at >= now() - interval '30 seconds' then
    return jsonb_build_object(
      'broadcast_id', v_row.id,
      'status', v_row.status,
      'finalized', false,
      'reason', 'in_flight'
    );
  end if;

  update public.line_broadcasts
  set status = 'pending_confirmation',
      api_result = 'pending_confirmation',
      error_message = '發送中斷，系統已標記待確認，不會自動重送',
      error_class = 'unknown',
      updated_at = now()
  where id = v_row.id
    and organization_id = p_organization_id
    and request_id = p_request_id
    and status = 'sending';

  if not found then
    return jsonb_build_object(
      'broadcast_id', v_row.id,
      'status', 'sending',
      'finalized', false
    );
  end if;

  perform public.insert_line_broadcast_event(
    p_organization_id,
    v_row.id,
    'pending_confirmation',
    '發送中斷，系統已標記待確認，不會自動重送'
  );

  return jsonb_build_object(
    'broadcast_id', v_row.id,
    'status', 'pending_confirmation',
    'api_result', 'pending_confirmation',
    'finalized', true
  );
end;
$$;

comment on function public.finalize_stale_line_broadcast_sending(text, text, text) is
  'Owner-only stale sending closer. sending older than 30s becomes pending_confirmation. Does not change send_claimed_at. Never calls LINE. Never retries.';

revoke all on function public.claim_line_broadcast_send(text, text, text, text)
  from public, anon;
grant execute on function public.claim_line_broadcast_send(text, text, text, text)
  to authenticated;
revoke all on function public.complete_line_broadcast_send(text, text, text, text, text, text, text, integer, text)
  from public, anon;
grant execute on function public.complete_line_broadcast_send(text, text, text, text, text, text, text, integer, text)
  to authenticated;
revoke all on function public.finalize_stale_line_broadcast_sending(text, text, text)
  from public, anon;
grant execute on function public.finalize_stale_line_broadcast_sending(text, text, text)
  to authenticated;
revoke all on function public.protect_line_broadcast_send_claimed_at()
  from public, anon, authenticated;
