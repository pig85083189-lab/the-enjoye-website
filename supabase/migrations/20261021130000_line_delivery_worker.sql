-- LINE delivery mock worker, owner-safe records, and broadcast quota lock.
-- Additive. Does not alter line_broadcasts, claim_line_broadcast_send, or jobs.
-- Does not store plaintext LINE user ids, ciphers, or channel credentials.
-- Does not call the LINE Messaging API, open send flags, or create Cron.
-- Mock accepted is not a real LINE delivery. Do not apply on Production until Owner confirms.

-- 87210000 = per delivery_key lock (Phase 3B).
-- 87210001 = per-organization lock so concurrent workers cannot exceed the
-- Taipei daily Broadcast cap of 3 across different delivery keys.

alter table public.line_delivery_tasks
  drop constraint if exists line_delivery_tasks_error_class_check;

alter table public.line_delivery_tasks
  add constraint line_delivery_tasks_error_class_check
  check (
    last_error_class is null
    or last_error_class in (
      'send_closed',
      'recipient_not_ready',
      'broadcast_not_eligible',
      'unauthorized',
      'forbidden',
      'invalid_request',
      'invalid_recipient',
      'invalid_message',
      'invalid_retry_key',
      'quota_exceeded',
      'timeout',
      'unknown',
      'mock_accepted'
    )
  );

create index if not exists line_delivery_tasks_org_kind_status_claimed_idx
  on public.line_delivery_tasks (organization_id, kind, status, claimed_at);

create or replace function public.line_delivery_broadcast_quota_used(
  p_organization_id text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_official integer := 0;
  v_delivery integer := 0;
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return 3;
  end if;

  if to_regprocedure('public.line_broadcast_consumed_on_taipei_day(text, timestamptz)') is not null then
    execute
      'select public.line_broadcast_consumed_on_taipei_day($1, now())'
      into v_official
      using p_organization_id;
  elsif to_regclass('public.line_broadcasts') is not null then
    execute
      $sql$
        select count(*)::integer
        from public.line_broadcasts s
        where s.organization_id = $1
          and (
            (
              s.send_claimed_at is not null
              and (s.send_claimed_at at time zone 'Asia/Taipei')::date
                = (now() at time zone 'Asia/Taipei')::date
            )
            or (
              s.send_claimed_at is null
              and s.status in ('accepted', 'sending', 'pending_confirmation')
              and (coalesce(s.confirmed_at, s.created_at) at time zone 'Asia/Taipei')::date
                = (now() at time zone 'Asia/Taipei')::date
            )
          )
      $sql$
      into v_official
      using p_organization_id;
  end if;

  select count(*)::integer
  into v_delivery
  from public.line_delivery_tasks t
  where t.organization_id = p_organization_id
    and t.kind = 'broadcast'
    and t.status in ('claimed', 'accepted', 'pending_confirmation')
    and (
      coalesce(t.claimed_at, t.updated_at, t.created_at) at time zone 'Asia/Taipei'
    )::date = (now() at time zone 'Asia/Taipei')::date;

  return greatest(coalesce(v_official, 0), 0) + greatest(coalesce(v_delivery, 0), 0);
end;
$$;

comment on function public.line_delivery_broadcast_quota_used(text) is
  'Taipei-day Broadcast consumption for the delivery ledger: official consumed plus never-resend delivery broadcast tasks. Never claims line_broadcasts. Never calls LINE.';

create or replace function public.line_delivery_broadcast_eligible(
  p_organization_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  -- Broadcast must not use customer LINE binding rules.
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return false;
  end if;
  if to_regclass('public.line_official_accounts') is null then
    return false;
  end if;
  select a.broadcast_enabled
  into v_enabled
  from public.line_official_accounts a
  where a.organization_id = p_organization_id;
  if v_enabled is not true then
    return false;
  end if;
  -- Matches LINE_BROADCAST_DAILY_LIMIT in application flags. Does not open send.
  if public.line_delivery_broadcast_quota_used(p_organization_id) >= 3 then
    return false;
  end if;
  return true;
end;
$$;

comment on function public.line_delivery_broadcast_eligible(text) is
  'Broadcast eligibility: official-account enablement plus Taipei daily quota including in-flight delivery tasks. Callers must hold the org delivery lock. Never uses customer bind RPCs. Never claims line_broadcasts. Never calls LINE.';

create or replace function public.claim_line_delivery_task(
  p_organization_id text,
  p_delivery_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.line_delivery_tasks%rowtype;
  v_claimed public.line_delivery_tasks%rowtype;
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
  if p_delivery_key is null or length(btrim(p_delivery_key)) = 0 then
    raise exception 'invalid delivery_key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(87210001, hashtext(p_organization_id));
  perform pg_advisory_xact_lock(
    87210000,
    hashtext(p_organization_id || chr(10) || p_delivery_key)
  );

  select *
  into v_row
  from public.line_delivery_tasks
  where organization_id = p_organization_id
    and delivery_key = p_delivery_key
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status in ('claimed', 'accepted', 'pending_confirmation') then
    return jsonb_build_object(
      'ok', false,
      'reason', 'duplicate',
      'status', v_row.status,
      'delivery_key', v_row.delivery_key
    );
  end if;
  if v_row.status is distinct from 'planned' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'not_claimable',
      'status', v_row.status,
      'delivery_key', v_row.delivery_key
    );
  end if;

  if v_row.kind = 'automation' then
    if to_regprocedure('public.line_automation_send_recipient_allowed(text, text)') is null
       or public.line_automation_send_recipient_allowed(
         v_row.organization_id,
         v_row.recipient_id
       ) is not true then
      update public.line_delivery_tasks
      set
        status = 'blocked',
        last_error = '發送前重新檢查：顧客 LINE 綁定尚未成為可信任收件人',
        last_error_class = 'recipient_not_ready',
        updated_at = now()
      where id = v_row.id
        and organization_id = p_organization_id
        and status = 'planned';
      return jsonb_build_object(
        'ok', false,
        'reason', 'recipient_not_ready',
        'status', 'blocked',
        'delivery_key', v_row.delivery_key
      );
    end if;
  elsif v_row.kind = 'broadcast' then
    if public.line_delivery_broadcast_eligible(v_row.organization_id) is not true then
      update public.line_delivery_tasks
      set
        status = 'blocked',
        last_error = '群發資格、同意或當日配額未通過',
        last_error_class = 'broadcast_not_eligible',
        updated_at = now()
      where id = v_row.id
        and organization_id = p_organization_id
        and status = 'planned';
      return jsonb_build_object(
        'ok', false,
        'reason', 'broadcast_not_eligible',
        'status', 'blocked',
        'delivery_key', v_row.delivery_key
      );
    end if;
  end if;

  update public.line_delivery_tasks
  set
    status = 'claimed',
    claimed_at = now(),
    attempt_count = attempt_count + 1,
    updated_at = now()
  where id = v_row.id
    and organization_id = p_organization_id
    and status = 'planned'
  returning * into v_claimed;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'reason', 'duplicate',
      'delivery_key', v_row.delivery_key
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_claimed.id,
    'delivery_key', v_claimed.delivery_key,
    'kind', v_claimed.kind,
    'status', v_claimed.status,
    'attempt_count', v_claimed.attempt_count,
    'claimed_at', v_claimed.claimed_at
  );
end;
$$;

comment on function public.claim_line_delivery_task(text, text) is
  'Owner-only atomic claim. Organization lock then per-key lock. Broadcast quota counts in-flight delivery tasks. Claimed/accepted/pending_confirmation never resend. Never calls LINE.';

create or replace function public.claim_next_line_delivery_task(
  p_organization_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.line_delivery_tasks%rowtype;
  v_fresh public.line_delivery_tasks%rowtype;
  v_claimed public.line_delivery_tasks%rowtype;
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

  perform pg_advisory_xact_lock(87210001, hashtext(p_organization_id));

  for v_row in
    select *
    from public.line_delivery_tasks
    where organization_id = p_organization_id
      and status = 'planned'
    order by created_at asc, id asc
    for update skip locked
  loop
    perform pg_advisory_xact_lock(
      87210000,
      hashtext(p_organization_id || chr(10) || v_row.delivery_key)
    );

    select *
    into v_fresh
    from public.line_delivery_tasks
    where id = v_row.id
      and organization_id = p_organization_id
    for update;

    if not found or v_fresh.status is distinct from 'planned' then
      continue;
    end if;

    if v_fresh.kind = 'automation' then
      if to_regprocedure('public.line_automation_send_recipient_allowed(text, text)') is null
         or public.line_automation_send_recipient_allowed(
           v_fresh.organization_id,
           v_fresh.recipient_id
         ) is not true then
        update public.line_delivery_tasks
        set
          status = 'blocked',
          last_error = '發送前重新檢查：顧客 LINE 綁定尚未成為可信任收件人',
          last_error_class = 'recipient_not_ready',
          updated_at = now()
        where id = v_fresh.id
          and organization_id = p_organization_id
          and status = 'planned';
        continue;
      end if;
    elsif v_fresh.kind = 'broadcast' then
      if public.line_delivery_broadcast_eligible(v_fresh.organization_id) is not true then
        update public.line_delivery_tasks
        set
          status = 'blocked',
          last_error = '群發資格、同意或當日配額未通過',
          last_error_class = 'broadcast_not_eligible',
          updated_at = now()
        where id = v_fresh.id
          and organization_id = p_organization_id
          and status = 'planned';
        continue;
      end if;
    end if;

    update public.line_delivery_tasks
    set
      status = 'claimed',
      claimed_at = now(),
      attempt_count = attempt_count + 1,
      updated_at = now()
    where id = v_fresh.id
      and organization_id = p_organization_id
      and status = 'planned'
    returning * into v_claimed;

    if not found then
      continue;
    end if;

    return jsonb_build_object(
      'ok', true,
      'id', v_claimed.id,
      'delivery_key', v_claimed.delivery_key,
      'kind', v_claimed.kind,
      'status', v_claimed.status,
      'attempt_count', v_claimed.attempt_count,
      'claimed_at', v_claimed.claimed_at
    );
  end loop;

  return jsonb_build_object('ok', false, 'reason', 'no_work');
end;
$$;

comment on function public.claim_next_line_delivery_task(text) is
  'Owner-only mock worker claim. Organization lock plus FOR UPDATE SKIP LOCKED. Never resends claimed/accepted/pending_confirmation. Never calls LINE.';

create or replace function public.complete_line_delivery_task(
  p_organization_id text,
  p_delivery_key text,
  p_status text,
  p_last_error text default null,
  p_error_class text default null,
  p_timed_out boolean default false,
  p_http_status integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.line_delivery_tasks%rowtype;
  v_status text;
  v_error_class text;
  v_error text;
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
  if p_delivery_key is null or length(btrim(p_delivery_key)) = 0 then
    raise exception 'invalid delivery_key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    87210000,
    hashtext(p_organization_id || chr(10) || p_delivery_key)
  );

  select *
  into v_row
  from public.line_delivery_tasks
  where organization_id = p_organization_id
    and delivery_key = p_delivery_key
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_timed_out is true or p_error_class = 'timeout' then
    v_status := 'pending_confirmation';
    v_error_class := 'timeout';
    v_error := coalesce(nullif(p_last_error, ''), 'LINE API 逾時，系統已標記待確認，不會自動重送');
  elsif p_error_class = 'unknown' or coalesce(p_http_status, 0) >= 500 then
    v_status := 'pending_confirmation';
    v_error_class := 'unknown';
    v_error := coalesce(nullif(p_last_error, ''), 'LINE API 回傳未知結果，系統已標記待確認，不會自動重送');
  elsif p_status = 'accepted' and p_error_class = 'mock_accepted' then
    v_status := 'accepted';
    v_error_class := 'mock_accepted';
    v_error := coalesce(nullif(p_last_error, ''), 'Mock adapter 接受，仍未發送真實 LINE');
  elsif p_status = 'accepted' then
    v_status := 'accepted';
    v_error_class := null;
    v_error := null;
  elsif p_status in ('failed', 'blocked', 'pending_confirmation') then
    v_status := p_status;
    v_error_class := p_error_class;
    v_error := p_last_error;
  else
    raise exception 'invalid status' using errcode = '22023';
  end if;

  if v_row.status = v_status then
    return jsonb_build_object(
      'ok', true,
      'reason', 'already_complete',
      'status', v_row.status,
      'delivery_key', v_row.delivery_key
    );
  end if;
  if v_row.status is distinct from 'claimed' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'not_claimable',
      'status', v_row.status,
      'delivery_key', v_row.delivery_key
    );
  end if;

  update public.line_delivery_tasks
  set
    status = v_status,
    last_error = v_error,
    last_error_class = v_error_class,
    updated_at = now()
  where id = v_row.id
    and organization_id = p_organization_id
    and status = 'claimed';

  return jsonb_build_object(
    'ok', true,
    'delivery_key', v_row.delivery_key,
    'status', v_status,
    'last_error_class', v_error_class,
    'mock_accepted', (v_status = 'accepted' and v_error_class = 'mock_accepted'),
    'sent_line', false
  );
end;
$$;

comment on function public.complete_line_delivery_task(text, text, text, text, text, boolean, integer) is
  'Owner-only completion of a claimed delivery task. Timeout, unknown, and 5xx become pending_confirmation and never resend. mock_accepted is not a real LINE delivery. Never calls LINE.';

create or replace function public.read_line_delivery_tasks(
  p_organization_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_records jsonb := '[]'::jsonb;
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

  select coalesce(
    jsonb_agg(row_payload order by created_at desc, id desc),
    '[]'::jsonb
  )
  into v_records
  from (
    select
      t.created_at,
      t.id,
      jsonb_build_object(
        'id', t.id,
        'kind', t.kind,
        'created_at', t.created_at,
        'status', t.status,
        'mock_accepted', (t.status = 'accepted' and t.last_error_class = 'mock_accepted'),
        'last_error', t.last_error,
        'needs_human_confirmation', (t.status = 'pending_confirmation'),
        'attempt_count', t.attempt_count,
        'sent_line', false
      ) as row_payload
    from public.line_delivery_tasks t
    where t.organization_id = p_organization_id
    order by t.created_at desc, t.id desc
    limit 100
  ) record_rows;

  return jsonb_build_object(
    'ok', true,
    'sent_line', false,
    'records', v_records
  );
end;
$$;

comment on function public.read_line_delivery_tasks(text) is
  'Owner-only delivery records. Returns kind, created_at, status, mock accepted, failure reason, and human-confirmation. Never returns LINE user ids, ciphers, credentials, recipient_id, or delivery_key. Never calls LINE.';

revoke all on function public.line_delivery_broadcast_quota_used(text)
  from public, anon, authenticated;
revoke all on function public.line_delivery_broadcast_eligible(text)
  from public, anon, authenticated;
revoke all on function public.claim_line_delivery_task(text, text)
  from public, anon;
revoke all on function public.claim_next_line_delivery_task(text)
  from public, anon;
revoke all on function public.complete_line_delivery_task(text, text, text, text, text, boolean, integer)
  from public, anon;
revoke all on function public.read_line_delivery_tasks(text)
  from public, anon;
revoke all on function public.enqueue_line_delivery_task(text, text, text, text)
  from public, anon;

grant execute on function public.enqueue_line_delivery_task(text, text, text, text)
  to authenticated;
grant execute on function public.claim_line_delivery_task(text, text)
  to authenticated;
grant execute on function public.claim_next_line_delivery_task(text)
  to authenticated;
grant execute on function public.complete_line_delivery_task(text, text, text, text, text, boolean, integer)
  to authenticated;
grant execute on function public.read_line_delivery_tasks(text)
  to authenticated;
