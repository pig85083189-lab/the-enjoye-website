-- Phase 3 additive birthday-year SQL contract, intentionally NOT applied remotely.
-- Preserves legacy birthday fingerprints for existing unsent jobs while accepting
-- year-scoped identities. Never modifies broadcast RPCs, cron, or send flags.
-- Must be tested against a disposable local PostgreSQL before deployment.
-- Depends on 20261023110000_line_automation_birthday_fingerprint_v2_helper.sql.

create or replace function public.line_automation_schedule_assert_cancelable(
  p_organization_id text,
  p_job public.line_automation_jobs
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_timing_ids text[];
  v_selected jsonb;
  v_state text;
  v_canonical text;
begin
  v_canonical := p_organization_id || '|' || p_job.automation_type || '|' || p_job.event_id || '|' || p_job.timing_id;
  if p_job.automation_type = 'birthday_greeting' then
    if p_job.scheduled_for is null then
      raise exception 'invalid fingerprint' using errcode = '22023';
    end if;
    if p_job.fingerprint is distinct from v_canonical
      and p_job.fingerprint is distinct from public.line_automation_birthday_fingerprint_v2(
        p_organization_id,
        p_job.customer_id,
        p_job.timing_id,
        (p_job.scheduled_for at time zone 'Asia/Taipei')::date +
          case when p_job.timing_id = 'days_before_3' then 3 else 0 end
      )
    then
      raise exception 'invalid fingerprint' using errcode = '22023';
    end if;
  elsif p_job.fingerprint is distinct from v_canonical then
    raise exception 'invalid fingerprint' using errcode = '22023';
  end if;

  if to_regclass('public.line_automation_rules') is null then
    raise exception 'cancel source incomplete' using errcode = '22023';
  end if;

  select
    r.enabled,
    coalesce(r.timing_ids, '{}'::text[]),
    r.timing_config->'selectedTimingIds'
  into v_enabled, v_timing_ids, v_selected
  from public.line_automation_rules r
  where r.organization_id = p_organization_id
    and r.automation_type = p_job.automation_type
  limit 1;

  if not found or v_enabled is not true then
    return;
  end if;
  if jsonb_typeof(v_selected) = 'array' then
    if not exists (
      select 1
      from jsonb_array_elements_text(v_selected) t
      where t = p_job.timing_id
    ) then
      return;
    end if;
  elsif not (p_job.timing_id = any (v_timing_ids)) then
    return;
  end if;

  v_state := public.line_automation_schedule_event_state(
    p_organization_id,
    p_job.automation_type,
    p_job.event_id,
    p_job.customer_id
  );
  if v_state = 'incomplete' then
    raise exception 'cancel source incomplete' using errcode = '22023';
  end if;
  if v_state = 'no' then
    return;
  end if;
  raise exception 'cancel not allowed' using errcode = '22023';
end;
$$;

create or replace function public.line_automation_schedule_validate_item(
  p_organization_id text,
  p_item jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type text;
  v_kind text;
  v_event_id text;
  v_customer_id text;
  v_timing text;
  v_fp text;
  v_scheduled timestamptz;
  v_expected timestamptz;
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'invalid schedule item' using errcode = '22023';
  end if;
  if p_item->>'organization_id' is distinct from p_organization_id then
    raise exception 'organization mismatch' using errcode = '42501';
  end if;
  v_type := p_item->>'automation_type';
  v_kind := p_item->>'event_kind';
  v_event_id := nullif(btrim(coalesce(p_item->>'event_id', '')), '');
  v_customer_id := nullif(btrim(coalesce(p_item->>'customer_id', '')), '');
  v_timing := p_item->>'timing_id';
  v_fp := p_item->>'fingerprint';
  if public.line_automation_schedule_event_kind(v_type) is null then
    raise exception 'invalid automation' using errcode = '22023';
  end if;
  if v_kind is distinct from public.line_automation_schedule_event_kind(v_type) then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  if not public.line_automation_schedule_timing_allowed(v_type, v_timing) then
    raise exception 'invalid timing' using errcode = '22023';
  end if;
  if v_event_id is null then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  if v_customer_id is null then
    raise exception 'invalid customer' using errcode = '22023';
  end if;
  -- The expected birthday year must be checked against the server-derived fire time
  -- after membership and schedule validation, not against a client-supplied year.
  if v_type <> 'birthday_greeting'
    and v_fp is distinct from (p_organization_id || '|' || v_type || '|' || v_event_id || '|' || v_timing)
  then
    raise exception 'invalid fingerprint' using errcode = '22023';
  end if;
  if v_type = 'holiday_greeting' then
    raise exception 'holiday source missing' using errcode = '22023';
  end if;
  if v_type = 'coupon_expiry' and to_regclass('public.customer_packages') is null then
    raise exception 'coupon source missing' using errcode = '22023';
  end if;
  if not public.line_automation_schedule_customer_belongs(p_organization_id, v_customer_id) then
    raise exception 'invalid customer' using errcode = '22023';
  end if;
  if not public.line_automation_schedule_event_belongs(
    p_organization_id, v_type, v_kind, v_event_id, v_customer_id
  ) then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  perform public.line_automation_schedule_rule_allows(
    p_organization_id,
    v_type,
    v_timing,
    coalesce(p_item->>'message_snapshot', '')
  );
  if p_item ? 'status'
    and p_item->>'status' not in ('scheduled', 'pending_recipient') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  begin
    v_scheduled := (p_item->>'scheduled_for')::timestamptz;
  exception
    when others then
      raise exception 'invalid scheduled_for' using errcode = '22023';
  end;
  v_expected := public.line_automation_schedule_expected_fire_at(
    p_organization_id, v_type, v_kind, v_event_id, v_customer_id, v_timing
  );
  if v_expected is null or v_scheduled is distinct from v_expected then
    raise exception 'invalid scheduled_for' using errcode = '22023';
  end if;
  if v_type = 'birthday_greeting' then
    if v_fp is distinct from (p_organization_id || '|' || v_type || '|' || v_event_id || '|' || v_timing)
      and v_fp is distinct from public.line_automation_birthday_fingerprint_v2(
        p_organization_id,
        v_customer_id,
        v_timing,
        (v_expected at time zone 'Asia/Taipei')::date +
          case when v_timing = 'days_before_3' then 3 else 0 end
      )
    then
      raise exception 'invalid fingerprint' using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function public.apply_line_automation_schedule(
  p_organization_id text,
  p_mutations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_inserted int := 0;
  v_updated int := 0;
  v_canceled int := 0;
  v_status text;
  v_id text;
  v_fp text;
  v_event_id text;
  v_customer_id text;
  v_ready boolean;
  v_existing public.line_automation_jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;
  if p_mutations is null or jsonb_typeof(p_mutations) <> 'object' then
    raise exception 'invalid mutations' using errcode = '22023';
  end if;
  if coalesce(p_mutations->>'organization_id', p_organization_id) is distinct from p_organization_id then
    raise exception 'organization mismatch' using errcode = '42501';
  end if;

  perform public.line_automation_schedule_lock_org(p_organization_id);

  for v_item in
    select value from jsonb_array_elements(coalesce(p_mutations->'cancel', '[]'::jsonb))
  loop
    if v_item->>'organization_id' is distinct from p_organization_id then
      raise exception 'organization mismatch' using errcode = '42501';
    end if;
    select *
    into v_existing
    from public.line_automation_jobs
    where organization_id = p_organization_id
      and id = v_item->>'id'
    for update;
    if not found then
      continue;
    end if;
    if v_existing.status not in ('scheduled', 'pending_recipient') then
      continue;
    end if;
    if nullif(btrim(coalesce(v_item->>'fingerprint', '')), '') is distinct from v_existing.fingerprint then
      raise exception 'invalid fingerprint' using errcode = '22023';
    end if;
    perform public.line_automation_schedule_assert_cancelable(p_organization_id, v_existing);
    update public.line_automation_jobs
    set
      status = 'canceled',
      skip_reason = 'schedule_recomputed',
      updated_at = now()
    where organization_id = p_organization_id
      and id = v_existing.id
      and fingerprint = v_existing.fingerprint
      and status in ('scheduled', 'pending_recipient');
    if found then
      v_canceled := v_canceled + 1;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_mutations->'update', '[]'::jsonb))
  loop
    if v_item->>'organization_id' is distinct from p_organization_id then
      raise exception 'organization mismatch' using errcode = '42501';
    end if;
    select *
    into v_existing
    from public.line_automation_jobs
    where organization_id = p_organization_id
      and id = v_item->>'id'
    for update;
    if not found then
      raise exception 'invalid job' using errcode = '22023';
    end if;
    if v_existing.status not in ('scheduled', 'pending_recipient') then
      continue;
    end if;
    perform public.line_automation_schedule_assert_job_identity(
      p_organization_id, v_item, v_existing
    );
    perform public.line_automation_schedule_validate_item(
      p_organization_id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'automation_type', v_existing.automation_type,
          'event_kind', coalesce(v_existing.event_kind, public.line_automation_schedule_event_kind(v_existing.automation_type)),
          'event_id', v_existing.event_id,
          'customer_id', v_existing.customer_id,
          'timing_id', v_existing.timing_id,
          'fingerprint', v_existing.fingerprint,
          'scheduled_for', v_item->>'scheduled_for',
          'message_snapshot', coalesce(v_item->>'message_snapshot', v_existing.message_snapshot, ''),
          'status', v_item->>'status'
        )
      )
    );
    v_customer_id := v_existing.customer_id;
    v_ready := public.line_automation_schedule_recipient_ready(p_organization_id, v_customer_id);
    select s.status, s.recipient_ready
    into v_status, v_ready
    from public.line_automation_schedule_apply_recipient(v_existing.status, v_ready) s;
    update public.line_automation_jobs
    set
      scheduled_for = (v_item->>'scheduled_for')::timestamptz,
      message_snapshot = coalesce(v_item->>'message_snapshot', message_snapshot),
      recipient_ready = v_ready,
      status = v_status,
      skip_reason = null,
      updated_at = now()
    where organization_id = p_organization_id
      and id = v_existing.id
      and fingerprint = v_existing.fingerprint
      and automation_type = v_existing.automation_type
      and event_id = v_existing.event_id
      and customer_id = v_existing.customer_id
      and timing_id = v_existing.timing_id
      and status in ('scheduled', 'pending_recipient');
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_mutations->'insert', '[]'::jsonb))
  loop
    perform public.line_automation_schedule_validate_item(p_organization_id, v_item);
    v_fp := v_item->>'fingerprint';
    v_event_id := v_item->>'event_id';
    v_customer_id := v_item->>'customer_id';
    v_ready := public.line_automation_schedule_recipient_ready(p_organization_id, v_customer_id);
    if exists (
      select 1
      from public.line_automation_jobs
      where organization_id = p_organization_id
        and fingerprint = v_fp
        and status in (
          'accepted', 'pending_confirmation', 'reconciled', 'claimed',
          'scheduled', 'pending_recipient'
        )
    ) then
      continue;
    end if;
    v_status := case when v_ready then 'scheduled' else 'pending_recipient' end;
    v_id := coalesce(
      nullif(v_item->>'id', ''),
      'laj-' || substr(md5(p_organization_id || ':' || v_fp), 1, 20)
    );
    insert into public.line_automation_jobs (
      id,
      organization_id,
      automation_type,
      event_kind,
      event_id,
      appointment_app_id,
      customer_id,
      customer_app_id,
      timing_id,
      fingerprint,
      scheduled_for,
      status,
      request_id,
      message_snapshot,
      recipient_ready
    ) values (
      v_id,
      p_organization_id,
      v_item->>'automation_type',
      v_item->>'event_kind',
      v_event_id,
      case when v_item->>'event_kind' = 'appointment' then v_event_id else null end,
      v_customer_id,
      v_customer_id,
      v_item->>'timing_id',
      v_fp,
      (v_item->>'scheduled_for')::timestamptz,
      v_status,
      coalesce(nullif(v_item->>'request_id', ''), 'lajq-' || substr(md5(v_fp || ':' || coalesce(v_item->>'scheduled_for', '')), 1, 16)),
      coalesce(v_item->>'message_snapshot', ''),
      v_ready
    )
    on conflict (organization_id, fingerprint)
    where status in ('scheduled', 'pending_recipient', 'claimed')
    do update set
      scheduled_for = excluded.scheduled_for,
      message_snapshot = excluded.message_snapshot,
      recipient_ready = excluded.recipient_ready,
      status = case
        when public.line_automation_jobs.status = 'claimed' then public.line_automation_jobs.status
        else excluded.status
      end,
      skip_reason = null,
      updated_at = now()
    where public.line_automation_jobs.status in ('scheduled', 'pending_recipient');
    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'inserted', v_inserted,
    'updated', v_updated,
    'canceled', v_canceled,
    'sent_line', false
  );
end;
$$;

-- Preserve the original security boundary on replaced SECURITY DEFINER functions.
revoke all on function public.line_automation_schedule_assert_cancelable(text, public.line_automation_jobs) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_validate_item(text, jsonb) from public, anon, authenticated;
revoke all on function public.apply_line_automation_schedule(text, jsonb) from public, anon;
grant execute on function public.apply_line_automation_schedule(text, jsonb) to authenticated;
