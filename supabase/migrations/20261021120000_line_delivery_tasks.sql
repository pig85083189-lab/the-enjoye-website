-- LINE delivery task ledger shared by broadcast and automation.
-- Additive. Does not alter line_broadcasts, claim_line_broadcast_send, or jobs.
-- Does not store plaintext LINE user ids, ciphers, or channel credentials.
-- Does not call the LINE Messaging API, open send flags, or create Cron.
-- Do not apply on Production until Owner confirms.

create table if not exists public.line_delivery_tasks (
  id text primary key,
  organization_id text not null,
  delivery_key text not null,
  kind text not null,
  recipient_id text not null,
  status text not null default 'planned',
  attempt_count integer not null default 0,
  claimed_at timestamptz,
  last_error text,
  last_error_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_delivery_tasks_id_prefix
    check (id like 'ldt-%'),
  constraint line_delivery_tasks_org_prefix
    check (organization_id like 'org-%'),
  constraint line_delivery_tasks_kind_check
    check (kind in ('broadcast', 'automation')),
  constraint line_delivery_tasks_status_check
    check (
      status in (
        'planned',
        'claimed',
        'blocked',
        'accepted',
        'failed',
        'pending_confirmation'
      )
    ),
  constraint line_delivery_tasks_attempt_nonnegative
    check (attempt_count >= 0),
  constraint line_delivery_tasks_no_line_user_id
    check (recipient_id !~ '^U[A-Za-z0-9]{32}$'),
  constraint line_delivery_tasks_error_class_check
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
        'unknown'
      )
    )
);

comment on table public.line_delivery_tasks is
  'Shared LINE delivery ledger. Unique delivery_key prevents duplicate sends. Never stores plaintext LINE user ids or credentials. Does not send.';

create unique index if not exists line_delivery_tasks_delivery_key_key
  on public.line_delivery_tasks (delivery_key);

create index if not exists line_delivery_tasks_org_status_idx
  on public.line_delivery_tasks (organization_id, status, created_at);

alter table public.line_delivery_tasks enable row level security;

revoke all on public.line_delivery_tasks from anon, authenticated, public;
grant select on public.line_delivery_tasks to authenticated;

drop policy if exists line_delivery_tasks_select_owner
  on public.line_delivery_tasks;
create policy line_delivery_tasks_select_owner
on public.line_delivery_tasks
for select
to authenticated
using (public.user_is_org_owner(organization_id));

create or replace function public.line_delivery_broadcast_eligible(
  p_organization_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_consumed integer := 0;
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
  if to_regprocedure('public.line_broadcast_consumed_on_taipei_day(text, timestamptz)') is not null then
    execute
      'select public.line_broadcast_consumed_on_taipei_day($1, now())'
      into v_consumed
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
      into v_consumed
      using p_organization_id;
  end if;
  -- Matches LINE_BROADCAST_DAILY_LIMIT in application flags. Does not open send.
  if coalesce(v_consumed, 0) >= 3 then
    return false;
  end if;
  return true;
end;
$$;

comment on function public.line_delivery_broadcast_eligible(text) is
  'Read-only Broadcast eligibility: official-account enablement plus Taipei daily quota. Never uses customer bind RPCs. Never claims line_broadcasts. Never calls LINE.';

create or replace function public.enqueue_line_delivery_task(
  p_organization_id text,
  p_kind text,
  p_delivery_key text,
  p_recipient_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id text;
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
  if p_kind is null or p_kind not in ('broadcast', 'automation') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_delivery_key is null or length(btrim(p_delivery_key)) = 0 then
    raise exception 'invalid delivery_key' using errcode = '22023';
  end if;
  if p_recipient_id is null or length(btrim(p_recipient_id)) = 0
     or p_recipient_id ~ '^U[A-Za-z0-9]{32}$' then
    raise exception 'invalid recipient' using errcode = '22023';
  end if;

  v_id := 'ldt-' || substr(md5(p_delivery_key), 1, 20);
  begin
    insert into public.line_delivery_tasks (
      id, organization_id, delivery_key, kind, recipient_id, status, attempt_count
    ) values (
      v_id, p_organization_id, p_delivery_key, p_kind, p_recipient_id, 'planned', 0
    );
  exception
    when unique_violation then
      return jsonb_build_object(
        'ok', false,
        'reason', 'duplicate',
        'delivery_key', p_delivery_key
      );
  end;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'delivery_key', p_delivery_key,
    'status', 'planned'
  );
end;
$$;

comment on function public.enqueue_line_delivery_task(text, text, text, text) is
  'Owner-only insert of a planned delivery task. Unique delivery_key. Never stores LINE user ids. Never sends.';

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
    'status', v_claimed.status,
    'attempt_count', v_claimed.attempt_count,
    'claimed_at', v_claimed.claimed_at
  );
end;
$$;

comment on function public.claim_line_delivery_task(text, text) is
  'Owner-only atomic claim. Advisory lock + FOR UPDATE. Automation re-reads trusted binding. Broadcast uses official-account enablement and quota. Claimed/accepted/pending_confirmation never resend. Never calls LINE.';

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
    'last_error_class', v_error_class
  );
end;
$$;

comment on function public.complete_line_delivery_task(text, text, text, text, text, boolean, integer) is
  'Owner-only completion of a claimed delivery task. Timeout, unknown, and 5xx become pending_confirmation and never resend. Never calls LINE.';

revoke all on function public.line_delivery_broadcast_eligible(text)
  from public, anon, authenticated;
revoke all on function public.enqueue_line_delivery_task(text, text, text, text)
  from public, anon;
revoke all on function public.claim_line_delivery_task(text, text)
  from public, anon;
revoke all on function public.complete_line_delivery_task(text, text, text, text, text, boolean, integer)
  from public, anon;

grant execute on function public.enqueue_line_delivery_task(text, text, text, text)
  to authenticated;
grant execute on function public.claim_line_delivery_task(text, text)
  to authenticated;
grant execute on function public.complete_line_delivery_task(text, text, text, text, text, boolean, integer)
  to authenticated;
