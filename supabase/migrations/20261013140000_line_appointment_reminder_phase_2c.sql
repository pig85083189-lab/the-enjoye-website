-- =============================================================================
-- Beauty OS LINE appointment reminder (Phase 2C)
-- Additive on 20261013120000. Do not apply remotely without Owner approval.
-- Bind rate limits, failed-attempt lock, consent split. No LINE send.
-- =============================================================================

alter table public.line_customer_bind_challenges
  add column if not exists locked_until timestamptz;

create index if not exists idx_line_customer_bind_challenges_recent
  on public.line_customer_bind_challenges (organization_id, customer_app_id, created_at desc);

create or replace function public.start_line_customer_bind_challenge(
  p_organization_id text,
  p_customer_app_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_code text;
  v_hash text;
  v_expires timestamptz := now() + interval '10 minutes';
  v_recent integer := 0;
  v_locked timestamptz;
begin
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_customer_app_id is null or length(btrim(p_customer_app_id)) < 3 then
    raise exception 'invalid customer' using errcode = '22023';
  end if;

  select max(locked_until) into v_locked
  from public.line_customer_bind_challenges
  where organization_id = p_organization_id
    and customer_app_id = p_customer_app_id;

  if v_locked is not null and v_locked > now() then
    return jsonb_build_object(
      'ok', false,
      'reason', 'attempt_limited',
      'locked_until', v_locked
    );
  end if;

  if exists (
    select 1 from public.line_customer_bind_challenges
    where organization_id = p_organization_id
      and customer_app_id = p_customer_app_id
      and created_at > now() - interval '60 seconds'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select count(*) into v_recent
  from public.line_customer_bind_challenges
  where organization_id = p_organization_id
    and customer_app_id = p_customer_app_id
    and created_at > now() - interval '15 minutes';

  if v_recent >= 3 then
    update public.line_customer_bind_challenges
    set locked_until = now() + interval '15 minutes'
    where organization_id = p_organization_id
      and customer_app_id = p_customer_app_id
      and consumed_at is null;
    return jsonb_build_object('ok', false, 'reason', 'attempt_limited');
  end if;

  update public.line_customer_bind_challenges
  set consumed_at = now()
  where organization_id = p_organization_id
    and customer_app_id = p_customer_app_id
    and consumed_at is null;

  v_id := 'lcc-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_hash := encode(sha256(convert_to(p_organization_id || ':' || v_code, 'utf8')), 'hex');

  insert into public.line_customer_bind_challenges (
    id, organization_id, customer_app_id, code_hash, expires_at
  ) values (v_id, p_organization_id, p_customer_app_id, v_hash, v_expires);

  return jsonb_build_object(
    'ok', true,
    'challenge_id', v_id,
    'code', v_code,
    'expires_at', v_expires,
    'consent', 'bind_does_not_opt_in'
  );
end;
$$;

create or replace function public.consume_line_customer_bind_challenge(
  p_organization_id text,
  p_code text,
  p_line_user_id_cipher text,
  p_line_user_id_hash text,
  p_line_user_id_hint text,
  p_key_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.line_customer_bind_challenges%rowtype;
  v_open public.line_customer_bind_challenges%rowtype;
  v_hash text;
  v_attempts integer;
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_line_user_id_hash is null or length(p_line_user_id_hash) <> 64 then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;
  if p_line_user_id_cipher is null or p_line_user_id_cipher not like 'v1.%' then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;

  v_hash := encode(sha256(convert_to(p_organization_id || ':' || upper(btrim(p_code)), 'utf8')), 'hex');

  select * into v_row
  from public.line_customer_bind_challenges
  where organization_id = p_organization_id
    and consumed_at is null
    and expires_at > now()
    and code_hash = v_hash
  for update;

  if found then
    if v_row.locked_until is not null and v_row.locked_until > now() then
      return jsonb_build_object('bound', false, 'reason', 'attempt_limited');
    end if;
  else
    select * into v_open
    from public.line_customer_bind_challenges
    where organization_id = p_organization_id
      and consumed_at is null
      and expires_at > now()
    order by created_at desc
    limit 1
    for update;

    if not found then
      return jsonb_build_object('bound', false, 'reason', 'invalid_input');
    end if;
    if v_open.locked_until is not null and v_open.locked_until > now() then
      return jsonb_build_object('bound', false, 'reason', 'attempt_limited');
    end if;

    v_attempts := coalesce(v_open.attempts, 0) + 1;
    update public.line_customer_bind_challenges
    set attempts = v_attempts,
        locked_until = case when v_attempts >= 5 then now() + interval '15 minutes' else locked_until end,
        consumed_at = case when v_attempts >= 5 then now() else consumed_at end
    where id = v_open.id;
    if v_attempts >= 5 then
      return jsonb_build_object('bound', false, 'reason', 'attempt_limited');
    end if;
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;
  if exists (
    select 1 from public.line_customer_bindings
    where organization_id = p_organization_id
      and line_user_id_hash = p_line_user_id_hash
      and unbound_at is null
      and customer_app_id <> v_row.customer_app_id
  ) then
    return jsonb_build_object('bound', false, 'reason', 'duplicate');
  end if;

  update public.line_customer_bind_challenges set consumed_at = now() where id = v_row.id;

  insert into public.line_customer_bindings (
    organization_id, customer_app_id, line_user_id_cipher, line_user_id_hash,
    line_user_id_hint, key_id, verified, bind_method, bound_at, updated_at
  ) values (
    p_organization_id, v_row.customer_app_id, p_line_user_id_cipher, p_line_user_id_hash,
    p_line_user_id_hint, p_key_id, true, 'webhook_code', now(), now()
  )
  on conflict (organization_id, customer_app_id) do update
    set line_user_id_cipher = excluded.line_user_id_cipher,
        line_user_id_hash = excluded.line_user_id_hash,
        line_user_id_hint = excluded.line_user_id_hint,
        key_id = excluded.key_id,
        verified = true,
        bind_method = 'webhook_code',
        bound_at = now(),
        unbound_at = null,
        blocked_at = null,
        updated_at = now();

  insert into public.line_notification_preferences (
    organization_id, customer_app_id, appointment_reminder_opt_in, unsubscribed_at, updated_at
  ) values (
    p_organization_id, v_row.customer_app_id, false, null, now()
  )
  on conflict (organization_id, customer_app_id) do nothing;

  return jsonb_build_object(
    'bound', true,
    'consented', false,
    'customer_app_id', v_row.customer_app_id
  );
end;
$$;

create or replace function public.set_line_appointment_reminder_consent(
  p_organization_id text,
  p_line_user_id_hash text,
  p_opt_in boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer text;
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select customer_app_id into v_customer
  from public.line_customer_bindings
  where organization_id = p_organization_id
    and line_user_id_hash = p_line_user_id_hash
    and unbound_at is null
    and verified = true;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'unbound');
  end if;
  insert into public.line_notification_preferences (
    organization_id, customer_app_id, appointment_reminder_opt_in, unsubscribed_at, updated_at
  ) values (
    p_organization_id,
    v_customer,
    coalesce(p_opt_in, false),
    case when coalesce(p_opt_in, false) then null else now() end,
    now()
  )
  on conflict (organization_id, customer_app_id) do update
    set appointment_reminder_opt_in = excluded.appointment_reminder_opt_in,
        unsubscribed_at = excluded.unsubscribed_at,
        updated_at = now();
  return jsonb_build_object('ok', true, 'opt_in', coalesce(p_opt_in, false));
end;
$$;

revoke all on function public.set_line_appointment_reminder_consent(text, text, boolean)
  from public, anon, authenticated;

create or replace function public.read_line_appointment_reminder_workspace(
  p_organization_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule public.line_automation_rules%rowtype;
  v_bind_count integer := 0;
  v_consent_count integer := 0;
  v_planned integer := 0;
begin
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_rule
  from public.line_automation_rules
  where organization_id = p_organization_id
    and automation_id = 'appointment_reminder';

  select count(*) into v_bind_count
  from public.line_customer_bindings b
  where b.organization_id = p_organization_id
    and b.verified = true
    and b.unbound_at is null
    and b.blocked_at is null;

  select count(*) into v_consent_count
  from public.line_customer_bindings b
  join public.line_notification_preferences p
    on p.organization_id = b.organization_id
   and p.customer_app_id = b.customer_app_id
  where b.organization_id = p_organization_id
    and b.verified = true
    and b.unbound_at is null
    and b.blocked_at is null
    and p.appointment_reminder_opt_in = true
    and p.unsubscribed_at is null;

  select count(*) into v_planned
  from public.line_automation_jobs
  where organization_id = p_organization_id
    and status = 'scheduled';

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'enabled', coalesce(v_rule.enabled, false),
    'timing_ids', coalesce(v_rule.timing_ids, '{}'),
    'template', coalesce(v_rule.template, ''),
    'saved', v_rule.organization_id is not null,
    'bind_count', v_bind_count,
    'consent_count', v_consent_count,
    'planned_count', v_planned
  );
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.set_line_appointment_reminder_consent(text, text, boolean) to service_role';
    execute 'grant execute on function public.consume_line_customer_bind_challenge(text, text, text, text, text, text) to service_role';
  end if;
end $$;
