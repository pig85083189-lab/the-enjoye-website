-- LINE delivery + official Broadcast shared Taipei daily quota.
-- Additive compatibility upgrade. Does not rewrite 020000 / 12120000 / 2120000 / 2130000 files.
-- Unifies Organization-level locks and campaign-level counting.
-- Quota is per 群發任務 (campaign id), not per recipient.
-- Unparseable delivery_key mappings fail-closed (treat used = 3 / refuse new claim).
-- Does not open send flags, create Cron, or call the LINE Messaging API.
-- Formal runtime stays closed. Do not apply on Production until Owner confirms.

-- 870121 = Channel lock (official claim). Taken first when a Channel exists.
-- 87210001 = per-organization delivery lock (Phase 3C).
-- 87210000 = per delivery_key lock (Phase 3B).

create or replace function public.line_delivery_key_segment(
  p_delivery_key text,
  p_index integer
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_rest text := p_delivery_key;
  v_i integer := 0;
  v_colon integer;
  v_len integer;
  v_part text;
begin
  if p_delivery_key is null or p_index is null or p_index < 0 then
    return null;
  end if;

  loop
    v_colon := position(':' in v_rest);
    if v_colon <= 1 then
      return null;
    end if;
    begin
      v_len := substring(v_rest from 1 for v_colon - 1)::integer;
    exception
      when others then
        return null;
    end;
    if v_len < 0 then
      return null;
    end if;
    v_part := substring(v_rest from v_colon + 1 for v_len);
    if char_length(v_part) is distinct from v_len then
      return null;
    end if;
    if v_i = p_index then
      return v_part;
    end if;
    v_rest := substring(v_rest from v_colon + 1 + v_len);
    if v_rest is null or v_rest = '' then
      return null;
    end if;
    if left(v_rest, 1) is distinct from '|' then
      return null;
    end if;
    v_rest := substring(v_rest from 2);
    v_i := v_i + 1;
  end loop;
end;
$$;

comment on function public.line_delivery_key_segment(text, integer) is
  'Length-prefixed delivery_key parser. Index 0=kind, 1=organization, 2=campaign/deliveryId, 3=recipient. Null when the key cannot be parsed.';

create or replace function public.line_broadcast_take_shared_quota_locks(
  p_organization_id text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_channel_id text;
  v_lock_org text;
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return;
  end if;

  if to_regclass('public.line_official_accounts') is not null then
    select a.channel_id
      into v_channel_id
    from public.line_official_accounts a
    where a.organization_id = p_organization_id;
  end if;

  if v_channel_id is not null and btrim(v_channel_id) <> '' then
    perform pg_advisory_xact_lock(870121, hashtext(v_channel_id));
  end if;

  if to_regclass('public.line_official_accounts') is not null then
    for v_lock_org in
      select a.organization_id
      from public.line_official_accounts a
      where a.organization_id = p_organization_id
         or (
           v_channel_id is not null
           and btrim(v_channel_id) <> ''
           and a.channel_id = v_channel_id
         )
      order by a.organization_id
    loop
      perform pg_advisory_xact_lock(87210001, hashtext(v_lock_org));
    end loop;
  end if;

  perform pg_advisory_xact_lock(87210001, hashtext(p_organization_id));
end;
$$;

comment on function public.line_broadcast_take_shared_quota_locks(text) is
  'Channel lock 870121 first when present, then 87210001 for the Organization and Channel peers. Same order as official Broadcast claim. Never calls LINE.';

create or replace function public.line_broadcast_campaign_mapping_ambiguous(
  p_organization_id text,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return true;
  end if;
  if to_regclass('public.line_delivery_tasks') is null then
    return false;
  end if;

  return exists (
    select 1
    from public.line_delivery_tasks t
    where t.organization_id = p_organization_id
      and t.kind = 'broadcast'
      and t.status in ('claimed', 'accepted', 'pending_confirmation')
      and (
        coalesce(t.claimed_at, t.updated_at, t.created_at) at time zone 'Asia/Taipei'
      )::date = (p_at at time zone 'Asia/Taipei')::date
      and (
        public.line_delivery_key_segment(t.delivery_key, 0) is distinct from 'broadcast'
        or public.line_delivery_key_segment(t.delivery_key, 2) is null
        or btrim(public.line_delivery_key_segment(t.delivery_key, 2)) = ''
      )
  );
end;
$$;

comment on function public.line_broadcast_campaign_mapping_ambiguous(text, timestamptz) is
  'True when a never-resend delivery broadcast today cannot be parsed into a campaign id. Fail-closed.';

create or replace function public.line_broadcast_campaign_on_official_ledger(
  p_organization_id text,
  p_campaign_id text,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return true;
  end if;
  if p_campaign_id is null or btrim(p_campaign_id) = '' then
    return true;
  end if;
  if to_regclass('public.line_broadcasts') is null then
    return false;
  end if;

  return exists (
    select 1
    from public.line_broadcasts s
    where s.organization_id = p_organization_id
      and s.id = p_campaign_id
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
      )
  );
end;
$$;

comment on function public.line_broadcast_campaign_on_official_ledger(text, text, timestamptz) is
  'True when this campaign id already consumed an official Broadcast slot today.';

create or replace function public.line_broadcast_campaign_on_delivery_ledger(
  p_organization_id text,
  p_campaign_id text,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return true;
  end if;
  if p_campaign_id is null or btrim(p_campaign_id) = '' then
    return true;
  end if;
  if public.line_broadcast_campaign_mapping_ambiguous(p_organization_id, p_at) then
    return true;
  end if;
  if to_regclass('public.line_delivery_tasks') is null then
    return false;
  end if;

  return exists (
    select 1
    from public.line_delivery_tasks t
    where t.organization_id = p_organization_id
      and t.kind = 'broadcast'
      and t.status in ('claimed', 'accepted', 'pending_confirmation')
      and (
        coalesce(t.claimed_at, t.updated_at, t.created_at) at time zone 'Asia/Taipei'
      )::date = (p_at at time zone 'Asia/Taipei')::date
      and public.line_delivery_key_segment(t.delivery_key, 2) = p_campaign_id
  );
end;
$$;

comment on function public.line_broadcast_campaign_on_delivery_ledger(text, text, timestamptz) is
  'True when this campaign id already has a never-resend delivery broadcast today, or mapping is ambiguous.';

create or replace function public.line_broadcast_shared_quota_used(
  p_organization_id text,
  p_at timestamptz default now()
)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_ids text[] := '{}';
  v_id text;
  v_key text;
  v_kind text;
  v_campaign text;
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return 3;
  end if;

  if to_regclass('public.line_broadcasts') is not null then
    for v_id in
      select s.id
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
        )
    loop
      if not (v_id = any (v_ids)) then
        v_ids := array_append(v_ids, v_id);
      end if;
    end loop;
  end if;

  if to_regclass('public.line_delivery_tasks') is not null then
    for v_key in
      select t.delivery_key
      from public.line_delivery_tasks t
      where t.organization_id = p_organization_id
        and t.kind = 'broadcast'
        and t.status in ('claimed', 'accepted', 'pending_confirmation')
        and (
          coalesce(t.claimed_at, t.updated_at, t.created_at) at time zone 'Asia/Taipei'
        )::date = (p_at at time zone 'Asia/Taipei')::date
    loop
      v_kind := public.line_delivery_key_segment(v_key, 0);
      v_campaign := public.line_delivery_key_segment(v_key, 2);
      if v_kind is distinct from 'broadcast'
         or v_campaign is null
         or btrim(v_campaign) = '' then
        return 3;
      end if;
      if not (v_campaign = any (v_ids)) then
        v_ids := array_append(v_ids, v_campaign);
      end if;
    end loop;
  end if;

  return coalesce(cardinality(v_ids), 0);
end;
$$;

comment on function public.line_broadcast_shared_quota_used(text, timestamptz) is
  'Union of official consumed Broadcast ids and parsed delivery campaign ids for one Organization on the Asia/Taipei day. Per campaign, not per recipient. Unparseable keys return 3. Never calls LINE.';

create or replace function public.line_broadcast_shared_quota_used_for_channel(
  p_channel_id text,
  p_at timestamptz default now()
)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_ids text[] := '{}';
  v_pair text;
  v_org text;
  v_id text;
  v_key text;
  v_kind text;
  v_campaign text;
begin
  if p_channel_id is null or btrim(p_channel_id) = '' then
    return 3;
  end if;
  if to_regclass('public.line_official_accounts') is null then
    return 0;
  end if;

  if to_regclass('public.line_broadcasts') is not null then
    for v_org, v_id in
      select s.organization_id, s.id
      from public.line_broadcasts s
      join public.line_official_accounts a
        on a.organization_id = s.organization_id
      where a.channel_id = p_channel_id
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
        )
    loop
      v_pair := v_org || chr(10) || v_id;
      if not (v_pair = any (v_ids)) then
        v_ids := array_append(v_ids, v_pair);
      end if;
    end loop;
  end if;

  if to_regclass('public.line_delivery_tasks') is not null then
    for v_org, v_key in
      select t.organization_id, t.delivery_key
      from public.line_delivery_tasks t
      join public.line_official_accounts a
        on a.organization_id = t.organization_id
      where a.channel_id = p_channel_id
        and t.kind = 'broadcast'
        and t.status in ('claimed', 'accepted', 'pending_confirmation')
        and (
          coalesce(t.claimed_at, t.updated_at, t.created_at) at time zone 'Asia/Taipei'
        )::date = (p_at at time zone 'Asia/Taipei')::date
    loop
      v_kind := public.line_delivery_key_segment(v_key, 0);
      v_campaign := public.line_delivery_key_segment(v_key, 2);
      if v_kind is distinct from 'broadcast'
         or v_campaign is null
         or btrim(v_campaign) = '' then
        return 3;
      end if;
      v_pair := v_org || chr(10) || v_campaign;
      if not (v_pair = any (v_ids)) then
        v_ids := array_append(v_ids, v_pair);
      end if;
    end loop;
  end if;

  return coalesce(cardinality(v_ids), 0);
end;
$$;

comment on function public.line_broadcast_shared_quota_used_for_channel(text, timestamptz) is
  'Union of official and delivery Broadcast campaigns for every Organization that shares the LINE Channel on the Asia/Taipei day. Unparseable keys return 3.';

create or replace function public.line_broadcast_consumed_on_taipei_day(
  p_organization_id text,
  p_at timestamptz default now()
)
returns integer
language sql
stable
set search_path = public
as $$
  select public.line_broadcast_shared_quota_used(p_organization_id, p_at);
$$;

comment on function public.line_broadcast_consumed_on_taipei_day(text, timestamptz) is
  'Shared Taipei-day Broadcast consumption: official consumed ids union delivery campaign ids. Per campaign, not per recipient. Unparseable delivery keys fail-closed at 3.';

create or replace function public.line_broadcast_consumed_on_taipei_day_for_channel(
  p_channel_id text,
  p_at timestamptz default now()
)
returns integer
language sql
stable
set search_path = public
as $$
  select public.line_broadcast_shared_quota_used_for_channel(p_channel_id, p_at);
$$;

comment on function public.line_broadcast_consumed_on_taipei_day_for_channel(text, timestamptz) is
  'Shared Taipei-day Broadcast consumption for every Organization on the LINE Channel. Union of official and delivery campaigns. Unparseable keys fail-closed at 3.';

create or replace function public.line_delivery_broadcast_quota_used(
  p_organization_id text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  return public.line_broadcast_shared_quota_used(p_organization_id, now());
end;
$$;

comment on function public.line_delivery_broadcast_quota_used(text) is
  'Taipei-day Broadcast consumption shared with official claim. Union of campaigns, not a sum of ledgers. Never claims line_broadcasts. Never calls LINE.';

create or replace function public.line_delivery_broadcast_claim_allowed(
  p_organization_id text,
  p_delivery_key text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_campaign text;
begin
  v_kind := public.line_delivery_key_segment(p_delivery_key, 0);
  v_campaign := public.line_delivery_key_segment(p_delivery_key, 2);
  if v_kind is distinct from 'broadcast'
     or v_campaign is null
     or btrim(v_campaign) = '' then
    return false;
  end if;
  if public.line_broadcast_campaign_mapping_ambiguous(p_organization_id) then
    return false;
  end if;
  if public.line_broadcast_campaign_on_official_ledger(p_organization_id, v_campaign) then
    return false;
  end if;
  return public.line_delivery_broadcast_eligible(p_organization_id);
end;
$$;

comment on function public.line_delivery_broadcast_claim_allowed(text, text) is
  'Broadcast delivery claim gate: parseable campaign, not already on the official ledger, and shared daily quota. Never calls LINE.';

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

  perform public.line_broadcast_take_shared_quota_locks(p_organization_id);
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
    if public.line_delivery_broadcast_claim_allowed(
         v_row.organization_id,
         v_row.delivery_key
       ) is not true then
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
  'Owner-only atomic claim. Channel lock then Organization lock then per-key lock. Broadcast quota is shared with official claim and counted per campaign. Never calls LINE.';

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

  perform public.line_broadcast_take_shared_quota_locks(p_organization_id);

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
      if public.line_delivery_broadcast_claim_allowed(
           v_fresh.organization_id,
           v_fresh.delivery_key
         ) is not true then
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
  'Owner-only mock worker claim. Shared Channel/Organization locks plus FOR UPDATE SKIP LOCKED. Broadcast quota is shared with official claim. Never calls LINE.';

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

  -- Shared Organization delivery lock. Channel lock 870121 is already held.
  perform public.line_broadcast_take_shared_quota_locks(p_organization_id);

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

  if public.line_broadcast_campaign_mapping_ambiguous(p_organization_id) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'quota_exceeded',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'quota_confirmed', false,
      'message', '無法對應群發活動，已停止發送'
    );
  end if;
  if public.line_broadcast_campaign_on_delivery_ledger(p_organization_id, v_row.id) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'duplicate',
      'broadcast_id', v_row.id,
      'request_id', v_row.request_id,
      'status', v_row.status,
      'quota_confirmed', false,
      'message', '這則群發已在發送帳本領取，不會重送'
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
  'Owner Channel-level FOR UPDATE claim plus shared Organization delivery lock 87210001. Quota is the union of official and delivery campaigns. Same campaign on the delivery ledger is refused. Client p_quota_* stays an untrusted fail-closed hint. quota_confirmed stays false. Formal never consumes the oneshot permit. Never calls LINE. Does not rewrite accepted history.';

revoke all on function public.line_delivery_key_segment(text, integer)
  from public, anon, authenticated;
revoke all on function public.line_broadcast_take_shared_quota_locks(text)
  from public, anon, authenticated;
revoke all on function public.line_broadcast_campaign_mapping_ambiguous(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.line_broadcast_campaign_on_official_ledger(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.line_broadcast_campaign_on_delivery_ledger(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.line_broadcast_shared_quota_used(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.line_broadcast_shared_quota_used_for_channel(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.line_broadcast_consumed_on_taipei_day(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.line_broadcast_consumed_on_taipei_day_for_channel(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.line_delivery_broadcast_quota_used(text)
  from public, anon, authenticated;
revoke all on function public.line_delivery_broadcast_claim_allowed(text, text)
  from public, anon, authenticated;
revoke all on function public.claim_line_broadcast_send(text, text, text, text, text, boolean, integer, timestamptz)
  from public, anon;
grant execute on function public.claim_line_broadcast_send(text, text, text, text, text, boolean, integer, timestamptz)
  to authenticated;
revoke all on function public.claim_line_delivery_task(text, text)
  from public, anon;
revoke all on function public.claim_next_line_delivery_task(text)
  from public, anon;
grant execute on function public.claim_line_delivery_task(text, text)
  to authenticated;
grant execute on function public.claim_next_line_delivery_task(text)
  to authenticated;
