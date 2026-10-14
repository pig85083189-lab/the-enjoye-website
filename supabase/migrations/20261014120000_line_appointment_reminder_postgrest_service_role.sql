-- =============================================================================
-- Beauty OS LINE appointment reminder (Phase 2D-3)
-- Privilege gate = PostgreSQL GRANT / effective EXECUTE, not caller identity
-- inside SECURITY DEFINER.
--
-- Risk if session_user = authenticator is treated as service_role:
--   PostgREST always logs in as authenticator, then SET ROLE to anon,
--   authenticated, or service_role. authenticator is shared. A DEFINER
--   wrapper granted to authenticated would also have session_user =
--   authenticator and could pass an authenticator identity check.
-- current_user inside SECURITY DEFINER is the function owner, not the
-- requester. request.jwt is client-settable and is not used.
--
-- External callers are authorized only by EXECUTE on the entry RPC.
-- Owner dry-run stays organization-scoped and does not call privileged
-- service RPCs (closes the DEFINER internal path).
-- Additive. Do not apply remotely without Owner approval.
-- Does not change LINE Broadcast claim/send, tokens, or Production RLS.
--
-- Rollback (Owner-approved Preview only):
--   1. Recreate privileged RPCs from
--      20261013120000_line_appointment_reminder_automation.sql and
--      20261013140000_line_appointment_reminder_phase_2c.sql
--   2. drop function public.run_line_appointment_reminder_cron_dry_run();
--   3. drop function public.line_appointment_reminder_dry_run_internal(text);
--   4. drop function public.line_appointment_reminder_service_role_call_allowed(text);
-- =============================================================================

create or replace function public.line_appointment_reminder_service_role_call_allowed(
  p_function text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_oid pg_catalog.regprocedure;
  v_public_execute boolean;
begin
  -- p_function is the callee GRANT lock. Not a JWT role and not session_user.
  if p_function is null
     or pg_catalog.strpos(p_function, ';') > 0
     or pg_catalog.strpos(p_function, '--') > 0
     or p_function not in (
       'public.finalize_stale_line_appointment_reminder_claimed(integer)',
       'public.run_line_appointment_reminder_cron_dry_run()',
       'public.list_due_line_appointment_reminder_jobs(text)',
       'public.claim_line_appointment_reminder_job(text,text,boolean,integer,timestamptz)',
       'public.complete_line_appointment_reminder_job(text,text,text,text,integer,text,text)',
       'public.consume_line_customer_bind_challenge(text,text,text,text,text,text)',
       'public.set_line_appointment_reminder_consent(text,text,boolean)',
       'public.mark_line_customer_unsubscribed(text,text)',
       'public.mark_line_customer_blocked(text,text)',
       'public.unbind_line_customer_by_hash(text,text)'
     ) then
    return false;
  end if;

  begin
    v_oid := p_function::pg_catalog.regprocedure;
  exception when others then
    return false;
  end;

  -- NULL proacl means PostgreSQL default PUBLIC EXECUTE.
  select
    case
      when p.proacl is null then true
      else exists (
        select 1
        from pg_catalog.aclexplode(p.proacl) a
        where a.grantee = 0
          and a.privilege_type = 'EXECUTE'
      )
    end
  into v_public_execute
  from pg_catalog.pg_proc p
  where p.oid = v_oid;
  if coalesce(v_public_execute, true) then
    return false;
  end if;

  -- Fail closed if EXECUTE leaked to PUBLIC / browser / login roles,
  -- or if the signature is unknown (has_function_privilege returns NULL).
  if coalesce(pg_catalog.has_function_privilege('anon', p_function, 'execute'), true)
     or coalesce(pg_catalog.has_function_privilege('authenticated', p_function, 'execute'), true) then
    return false;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator')
     and coalesce(
       pg_catalog.has_function_privilege('authenticator', p_function, 'execute'),
       false
     ) then
    return false;
  end if;
  if not coalesce(
    pg_catalog.has_function_privilege('service_role', p_function, 'execute'),
    false
  ) then
    return false;
  end if;

  -- GRANT already ran as the PostgREST SET ROLE before this body.
  -- Do not treat session_user, current_user, or request claims as the caller.
  return true;
end;
$$;

revoke all on function public.line_appointment_reminder_service_role_call_allowed(text)
  from public, anon, authenticated, service_role;

create or replace function public.line_appointment_reminder_dry_run_internal(
  p_organization_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_checked integer := 0;
  v_eligible boolean;
  v_reason text;
  v_message text;
  v_rule public.line_automation_rules%rowtype;
  v_bind public.line_customer_bindings%rowtype;
  v_pref public.line_notification_preferences%rowtype;
  v_appt_status text;
  v_appt_starts timestamptz;
  v_appt_customer text;
  v_appt_service text;
  v_fire timestamptz;
  v_inflight boolean;
  v_has_appointments boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'appointments'
  ) into v_has_appointments;

  for v_job in
    select *
    from public.line_automation_jobs
    where status = 'scheduled'
      and scheduled_for <= now()
      and scheduled_for >= now() - interval '20 minutes'
      and (p_organization_id is null or organization_id = p_organization_id)
    order by scheduled_for
  loop
    v_eligible := false;
    v_reason := null;
    v_message := 'Dry-run 檢查未完成';

    select * into v_rule
    from public.line_automation_rules
    where organization_id = v_job.organization_id
      and automation_id = 'appointment_reminder';

    if v_rule.organization_id is null or v_rule.enabled is not true then
      v_reason := 'rule_disabled';
      v_message := '規則未啟用，Dry-run 不會發送';
    elsif not (v_job.timing_id = any (coalesce(v_rule.timing_ids, '{}'::text[]))) then
      v_reason := 'timing_disabled';
      v_message := '此時機已關閉，Dry-run 不會發送';
    else
      v_appt_status := null;
      v_appt_starts := null;
      v_appt_customer := null;
      v_appt_service := null;
      if v_has_appointments then
        begin
          execute $q$
            select a.status::text, a.starts_at, c.app_id, s.app_id
            from public.appointments a
            join public.organizations o on o.id = a.organization_id
            join public.customers c on c.id = a.customer_id
            join public.services s on s.id = a.service_id
            where o.app_id = $1 and a.app_id = $2
          $q$ into v_appt_status, v_appt_starts, v_appt_customer, v_appt_service
          using v_job.organization_id, v_job.appointment_app_id;
        exception when undefined_table or undefined_column then
          v_appt_status := null;
        end;
      end if;

      if v_appt_status is null then
        v_reason := 'appointment_inactive';
        v_message := '找不到可驗證的預約，Dry-run 不會發送';
      elsif v_appt_status in ('CANCELLED', 'NO_SHOW') then
        v_reason := 'appointment_cancelled';
        v_message := '預約已取消，不會發送';
      elsif v_appt_status = 'COMPLETED' then
        v_reason := 'appointment_completed';
        v_message := '預約已完成，不會發送';
      elsif v_appt_status not in ('BOOKED', 'CONFIRMED') then
        v_reason := 'appointment_inactive';
        v_message := '預約狀態已變更，不會發送';
      elsif v_appt_customer is distinct from v_job.customer_app_id
         or v_appt_service is distinct from v_job.service_app_id then
        v_reason := 'fingerprint_changed';
        v_message := '預約內容已變更，舊提醒不會發送';
      else
        if v_job.timing_id = 'hours_before_3' then
          v_fire := v_appt_starts - interval '3 hours';
        else
          v_fire := (
            ((v_appt_starts at time zone 'Asia/Taipei')::date - 1) + time '10:00'
          ) at time zone 'Asia/Taipei';
        end if;
        if v_fire is distinct from v_job.scheduled_for then
          v_reason := 'fingerprint_changed';
          v_message := '預約時間已變更，舊提醒不會發送';
        else
          select * into v_bind
          from public.line_customer_bindings
          where organization_id = v_job.organization_id
            and customer_app_id = v_job.customer_app_id;
          select * into v_pref
          from public.line_notification_preferences
          where organization_id = v_job.organization_id
            and customer_app_id = v_job.customer_app_id;

          if v_bind.organization_id is null or v_bind.verified is not true
             or v_bind.unbound_at is not null then
            v_reason := 'unbound';
            v_message := '客人尚未完成已驗證的 LINE 綁定，系統不會發送';
          elsif v_bind.blocked_at is not null then
            v_reason := 'blocked';
            v_message := '客人已封鎖官方帳號，系統不會發送';
          elsif v_pref.organization_id is null or v_pref.appointment_reminder_opt_in is not true then
            v_reason := 'not_consented';
            v_message := '客人尚未同意預約提醒通知';
          elsif v_pref.unsubscribed_at is not null then
            v_reason := 'unsubscribed';
            v_message := '客人已退訂預約提醒，系統不會發送';
          else
            select exists (
              select 1 from public.line_broadcasts b
              join public.line_official_accounts a on a.organization_id = b.organization_id
              join public.line_official_accounts mine on mine.organization_id = v_job.organization_id
              where a.channel_id = mine.channel_id
                and b.status = 'sending'
            ) or exists (
              select 1 from public.line_automation_jobs j
              join public.line_official_accounts a on a.organization_id = j.organization_id
              join public.line_official_accounts mine on mine.organization_id = v_job.organization_id
              where a.channel_id = mine.channel_id
                and j.status = 'claimed'
                and j.claimed_at > now() - interval '30 seconds'
            ) into v_inflight;
            if v_inflight then
              v_reason := 'inflight';
              v_message := '同一 LINE Channel 尚有發送進行中，已停止以免超額';
            else
              v_reason := 'quota_unknown';
              v_message := 'Dry-run 未查詢 LINE 額度，正式發送關閉，沒有連接 LINE Push';
            end if;
          end if;
        end if;
      end if;
    end if;

    insert into public.line_automation_dry_runs (
      id, organization_id, job_id, request_id, eligible, skip_reason, message
    ) values (
      'ldr-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
      v_job.organization_id, v_job.id, v_job.request_id, v_eligible,
      v_reason, left(v_message, 200)
    );
    v_checked := v_checked + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'checked', v_checked,
    'sent', false,
    'eligible', false
  );
end;
$$;

revoke all on function public.line_appointment_reminder_dry_run_internal(text)
  from public, anon, authenticated, service_role;

create or replace function public.finalize_stale_line_appointment_reminder_claimed(
  p_stale_after_seconds integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not public.line_appointment_reminder_service_role_call_allowed(
    'public.finalize_stale_line_appointment_reminder_claimed(integer)'
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.line_automation_jobs
  set status = 'pending_confirmation',
      updated_at = now()
  where status = 'claimed'
    and claimed_at is not null
    and claimed_at < now() - make_interval(secs => greatest(p_stale_after_seconds, 5));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.finalize_stale_line_appointment_reminder_claimed(integer)
  from public, anon, authenticated;

create or replace function public.run_line_appointment_reminder_cron_dry_run()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.line_appointment_reminder_service_role_call_allowed(
    'public.run_line_appointment_reminder_cron_dry_run()'
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform public.finalize_stale_line_appointment_reminder_claimed(30);
  return public.line_appointment_reminder_dry_run_internal(null);
end;
$$;

revoke all on function public.run_line_appointment_reminder_cron_dry_run()
  from public, anon, authenticated;

create or replace function public.run_line_appointment_reminder_dry_run(
  p_organization_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_organization_id is null then
    if session_user not in ('postgres', 'service_role', 'supabase_admin') then
      raise exception 'unauthorized' using errcode = '42501';
    end if;
  elsif session_user not in ('postgres', 'service_role', 'supabase_admin')
     and not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  -- Do not call privileged service RPCs from this authenticated entry.
  return public.line_appointment_reminder_dry_run_internal(p_organization_id);
end;
$$;

revoke all on function public.run_line_appointment_reminder_dry_run(text) from public, anon;
grant execute on function public.run_line_appointment_reminder_dry_run(text) to authenticated;

create or replace function public.list_due_line_appointment_reminder_jobs(
  p_organization_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.line_appointment_reminder_service_role_call_allowed(
    'public.list_due_line_appointment_reminder_jobs(text)'
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'organizationId', organization_id,
      'appointmentId', appointment_app_id,
      'customerId', customer_app_id,
      'serviceId', service_app_id,
      'timingId', timing_id,
      'fingerprint', fingerprint,
      'scheduledFor', scheduled_for,
      'status', status,
      'requestId', request_id,
      'claimedAt', claimed_at,
      'sendClaimedAt', send_claimed_at
    ) order by scheduled_for)
    from public.line_automation_jobs
    where status = 'scheduled'
      and scheduled_for <= now()
      and scheduled_for >= now() - interval '20 minutes'
      and (p_organization_id is null or organization_id = p_organization_id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_due_line_appointment_reminder_jobs(text)
  from public, anon, authenticated;

create or replace function public.claim_line_appointment_reminder_job(
  p_organization_id text,
  p_request_id text,
  p_quota_known boolean,
  p_quota_remaining integer,
  p_quota_checked_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.line_automation_jobs%rowtype;
  v_channel_id text;
  v_lock_key bigint;
begin
  if not public.line_appointment_reminder_service_role_call_allowed(
    'public.claim_line_appointment_reminder_job(text,text,boolean,integer,timestamptz)'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_request_id is null or p_request_id not like 'larq-%' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  perform public.finalize_stale_line_appointment_reminder_claimed(30);

  select channel_id into v_channel_id
  from public.line_official_accounts
  where organization_id = p_organization_id;
  if v_channel_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_configured');
  end if;

  v_lock_key := ('x' || substr(md5('line-channel-lock:' || v_channel_id), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(870121, (v_lock_key % 2147483647)::int);

  if exists (
    select 1 from public.line_broadcasts b
    join public.line_official_accounts a on a.organization_id = b.organization_id
    where a.channel_id = v_channel_id
      and b.status = 'sending'
  ) or exists (
    select 1 from public.line_automation_jobs j
    join public.line_official_accounts a on a.organization_id = j.organization_id
    where a.channel_id = v_channel_id
      and j.status = 'claimed'
      and j.claimed_at > now() - interval '30 seconds'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pending_confirmation');
  end if;

  if p_quota_known is not true then
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded');
  end if;
  if p_quota_remaining is not null and p_quota_remaining <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded');
  end if;
  if p_quota_checked_at is null or p_quota_checked_at < now() - interval '30 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded');
  end if;

  select * into v_job
  from public.line_automation_jobs
  where organization_id = p_organization_id
    and request_id = p_request_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  if v_job.status in ('accepted', 'failed', 'canceled', 'expired', 'skipped', 'pending_confirmation', 'reconciled')
     or v_job.send_claimed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  if v_job.status = 'claimed' then
    return jsonb_build_object('ok', false, 'reason', 'pending_confirmation');
  end if;
  if v_job.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'send_closed');
  end if;
  if v_job.scheduled_for > now() then
    return jsonb_build_object('ok', false, 'reason', 'send_closed');
  end if;
  if v_job.scheduled_for < now() - interval '20 minutes' then
    update public.line_automation_jobs
    set status = 'expired', skip_reason = 'expired_window', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', false, 'reason', 'send_closed');
  end if;

  update public.line_automation_jobs
  set status = 'claimed', claimed_at = now(), send_claimed_at = now(), updated_at = now()
  where id = v_job.id and status = 'scheduled' and send_claimed_at is null
  returning * into v_job;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  return jsonb_build_object('ok', true, 'request_id', v_job.request_id, 'job_id', v_job.id);
end;
$$;

revoke all on function public.claim_line_appointment_reminder_job(text, text, boolean, integer, timestamptz)
  from public, anon, authenticated;

create or replace function public.complete_line_appointment_reminder_job(
  p_organization_id text,
  p_request_id text,
  p_status text,
  p_line_request_id text,
  p_http_status integer,
  p_error_class text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.line_automation_jobs%rowtype;
begin
  if not public.line_appointment_reminder_service_role_call_allowed(
    'public.complete_line_appointment_reminder_job(text,text,text,text,integer,text,text)'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_status not in ('accepted', 'failed', 'pending_confirmation', 'skipped', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  select * into v_job
  from public.line_automation_jobs
  where organization_id = p_organization_id and request_id = p_request_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  if v_job.status in ('accepted', 'pending_confirmation') then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  update public.line_automation_jobs
  set status = p_status, updated_at = now()
  where id = v_job.id;

  insert into public.line_automation_deliveries (
    id, organization_id, job_id, request_id, status,
    line_request_id, http_status, error_class, message
  ) values (
    'lad-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
    p_organization_id, v_job.id, p_request_id, p_status,
    p_line_request_id, p_http_status, p_error_class, left(coalesce(p_message, ''), 200)
  )
  on conflict (request_id) do nothing;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.complete_line_appointment_reminder_job(text, text, text, text, integer, text, text)
  from public, anon, authenticated;

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
  if not public.line_appointment_reminder_service_role_call_allowed(
    'public.consume_line_customer_bind_challenge(text,text,text,text,text,text)'
  ) then
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

revoke all on function public.consume_line_customer_bind_challenge(text, text, text, text, text, text)
  from public, anon, authenticated;

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
  if not public.line_appointment_reminder_service_role_call_allowed(
    'public.set_line_appointment_reminder_consent(text,text,boolean)'
  ) then
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

create or replace function public.mark_line_customer_unsubscribed(
  p_organization_id text,
  p_line_user_id_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.line_appointment_reminder_service_role_call_allowed(
    'public.mark_line_customer_unsubscribed(text,text)'
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.line_notification_preferences p
  set appointment_reminder_opt_in = false,
      unsubscribed_at = now(),
      updated_at = now()
  from public.line_customer_bindings b
  where b.organization_id = p_organization_id
    and b.line_user_id_hash = p_line_user_id_hash
    and b.unbound_at is null
    and p.organization_id = b.organization_id
    and p.customer_app_id = b.customer_app_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_line_customer_unsubscribed(text, text)
  from public, anon, authenticated;

create or replace function public.mark_line_customer_blocked(
  p_organization_id text,
  p_line_user_id_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.line_appointment_reminder_service_role_call_allowed(
    'public.mark_line_customer_blocked(text,text)'
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.line_customer_bindings
  set blocked_at = now(), updated_at = now()
  where organization_id = p_organization_id
    and line_user_id_hash = p_line_user_id_hash
    and unbound_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_line_customer_blocked(text, text)
  from public, anon, authenticated;

create or replace function public.unbind_line_customer_by_hash(
  p_organization_id text,
  p_line_user_id_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.line_appointment_reminder_service_role_call_allowed(
    'public.unbind_line_customer_by_hash(text,text)'
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.line_customer_bindings
  set unbound_at = now(), verified = false, updated_at = now()
  where organization_id = p_organization_id
    and line_user_id_hash = p_line_user_id_hash
    and unbound_at is null;
  update public.line_notification_preferences p
  set appointment_reminder_opt_in = false,
      unsubscribed_at = now(),
      updated_at = now()
  from public.line_customer_bindings b
  where b.organization_id = p_organization_id
    and b.line_user_id_hash = p_line_user_id_hash
    and p.organization_id = b.organization_id
    and p.customer_app_id = b.customer_app_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.unbind_line_customer_by_hash(text, text)
  from public, anon, authenticated;

do $$
declare
  v_sig text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.finalize_stale_line_appointment_reminder_claimed(integer) to service_role';
    execute 'grant execute on function public.run_line_appointment_reminder_cron_dry_run() to service_role';
    execute 'grant execute on function public.list_due_line_appointment_reminder_jobs(text) to service_role';
    execute 'grant execute on function public.claim_line_appointment_reminder_job(text, text, boolean, integer, timestamptz) to service_role';
    execute 'grant execute on function public.complete_line_appointment_reminder_job(text, text, text, text, integer, text, text) to service_role';
    execute 'grant execute on function public.consume_line_customer_bind_challenge(text, text, text, text, text, text) to service_role';
    execute 'grant execute on function public.set_line_appointment_reminder_consent(text, text, boolean) to service_role';
    execute 'grant execute on function public.mark_line_customer_unsubscribed(text, text) to service_role';
    execute 'grant execute on function public.mark_line_customer_blocked(text, text) to service_role';
    execute 'grant execute on function public.unbind_line_customer_by_hash(text, text) to service_role';
    execute 'grant execute on function public.run_line_appointment_reminder_dry_run(text) to service_role';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    foreach v_sig in array array[
      'public.line_appointment_reminder_service_role_call_allowed(text)',
      'public.line_appointment_reminder_dry_run_internal(text)',
      'public.finalize_stale_line_appointment_reminder_claimed(integer)',
      'public.run_line_appointment_reminder_cron_dry_run()',
      'public.list_due_line_appointment_reminder_jobs(text)',
      'public.claim_line_appointment_reminder_job(text, text, boolean, integer, timestamptz)',
      'public.complete_line_appointment_reminder_job(text, text, text, text, integer, text, text)',
      'public.consume_line_customer_bind_challenge(text, text, text, text, text, text)',
      'public.set_line_appointment_reminder_consent(text, text, boolean)',
      'public.mark_line_customer_unsubscribed(text, text)',
      'public.mark_line_customer_blocked(text, text)',
      'public.unbind_line_customer_by_hash(text, text)',
      'public.run_line_appointment_reminder_dry_run(text)'
    ]
    loop
      execute format('revoke all on function %s from authenticator', v_sig);
    end loop;
  end if;
end $$;
