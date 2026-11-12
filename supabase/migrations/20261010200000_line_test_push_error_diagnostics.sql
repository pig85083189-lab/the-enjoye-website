-- Preview-safe additive diagnostics for LINE test Push.
-- Records HTTP status + whitelist error_class only.
-- Does not rewrite 120000 / 140000 / 160000 / 180000 / 190000.
-- Does not backfill existing rows.
-- Does not open send switches. Does not touch THE ENJOYE operational rows.
-- Does not store LINE bodies or credential/recipient plaintext.

alter table public.line_test_sends
  add column if not exists http_status integer,
  add column if not exists error_class text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'line_test_sends_http_status_check'
  ) then
    alter table public.line_test_sends
      add constraint line_test_sends_http_status_check
      check (http_status is null or (http_status >= 100 and http_status <= 599));
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'line_test_sends_error_class_check'
  ) then
    alter table public.line_test_sends
      add constraint line_test_sends_error_class_check
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

comment on column public.line_test_sends.http_status is
  'LINE HTTP status from the Push response. Never backfilled. Null on older rows.';
comment on column public.line_test_sends.error_class is
  'Safe whitelist class from HTTP status / timeout only. Never stores LINE response body or secrets.';

create or replace function public.complete_line_test_send(
  p_organization_id text,
  p_test_send_id text,
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
  v_row public.line_test_sends%rowtype;
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
      http_status = v_http_status,
      error_class = v_error_class,
      updated_at = now()
  where id = v_row.id
    and organization_id = p_organization_id
    and request_id = p_request_id
    and status = 'sending';

  v_event := case p_status
    when 'accepted' then 'test_api_accepted'
    when 'pending_confirmation' then 'test_pending_confirmation'
    when 'send_closed' then 'test_send_closed'
    else 'test_api_failed'
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
    p_organization_id, null, v_event, v_detail
  );
  return jsonb_build_object(
    'test_send_id', v_row.id,
    'status', p_status,
    'api_result', p_api_result,
    'completed', true
  );
end;
$$;

comment on function public.complete_line_test_send(text, text, text, text, text, text, text, integer, text) is
  'Owner + org-scoped complete. Stores HTTP status and whitelist error class only. Never backfills older rows. No retry.';

drop function if exists public.complete_line_test_send(text, text, text, text, text, text, text);

revoke all on function public.complete_line_test_send(text, text, text, text, text, text, text, integer, text)
  from public, anon;
grant execute on function public.complete_line_test_send(text, text, text, text, text, text, text, integer, text)
  to authenticated;
