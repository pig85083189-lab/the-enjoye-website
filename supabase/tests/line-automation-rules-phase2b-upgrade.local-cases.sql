-- Local-only assertions after applying 20261017120000 onto a Phase 2B table.
-- Never connect to Preview or Production. Never call LINE.

do $$
declare
  v_rule public.line_automation_rules%rowtype;
  v_workspace jsonb;
  v_saved jsonb;
  v_sync jsonb;
  v_keep text;
  v_removed text;
  v_other text;
  v_rule_count integer;
begin
  select * into v_rule
  from public.line_automation_rules
  where organization_id = 'org-the-enjoye'
    and automation_id = 'appointment_reminder';

  if not found then
    raise exception 'upgrade lost the Phase 2B appointment reminder row';
  end if;
  if v_rule.template is distinct from '舊預約提醒範本，請勿覆蓋' then
    raise exception 'backfill overwrote existing template: %', v_rule.template;
  end if;
  if v_rule.enabled is distinct from true then
    raise exception 'backfill overwrote enabled';
  end if;
  if v_rule.timing_ids is distinct from array['day_before_morning', 'hours_before_3']::text[] then
    raise exception 'backfill overwrote timing_ids: %', v_rule.timing_ids;
  end if;
  if v_rule.automation_type is distinct from 'appointment_reminder' then
    raise exception 'automation_type was not copied from automation_id';
  end if;
  if v_rule.message_template is distinct from '舊預約提醒範本，請勿覆蓋' then
    raise exception 'message_template was not copied from template';
  end if;
  if v_rule.updated_by is distinct from 'staff-enjoye-owner' then
    raise exception 'updated_by was not copied from updated_by_staff_id';
  end if;
  if v_rule.id is null or v_rule.id not like 'lar-%' then
    raise exception 'id was not backfilled: %', v_rule.id;
  end if;
  if jsonb_typeof(v_rule.timing_config->'customTimings') is distinct from 'array' then
    raise exception 'timing_config.customTimings missing after upgrade';
  end if;
  if v_rule.timing_config->'selectedTimingIds' is distinct from '["day_before_morning", "hours_before_3"]'::jsonb then
    raise exception 'timing_config.selectedTimingIds mismatch: %', v_rule.timing_config;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'line_automation_rules_org_type_unique'
  ) then
    raise exception 'missing unique (organization_id, automation_type)';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'line_automation_rules_id_unique'
  ) then
    raise exception 'missing unique (id)';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'user_operational_staff_id'
      and p.pronargs = 1
      and pg_catalog.format_type(p.proargtypes[0], null) = 'uuid'
  ) then
    raise exception 'user_operational_staff_id(uuid) is missing; have %', (
      select coalesce(string_agg(pg_get_function_identity_arguments(p.oid), ', '), '<none>')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'user_operational_staff_id'
    );
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'user_operational_staff_id'
      and (
        p.pronargs <> 1
        or pg_catalog.format_type(p.proargtypes[0], null) <> 'uuid'
      )
  ) then
    raise exception 'unexpected user_operational_staff_id overload';
  end if;

  perform tests.become('11111111-1111-1111-1111-111111111111');

  v_workspace := public.read_line_appointment_reminder_workspace('org-the-enjoye');
  if v_workspace->>'template' is distinct from '舊預約提醒範本，請勿覆蓋' then
    raise exception 'Phase 2B read after upgrade lost the old template: %', v_workspace;
  end if;
  if v_workspace->>'enabled' is distinct from 'true' then
    raise exception 'Phase 2B read after upgrade lost enabled';
  end if;

  v_saved := public.upsert_line_automation_rule(
    'org-the-enjoye',
    'appointment_reminder',
    true,
    jsonb_build_object(
      'selectedTimingIds', '["day_before_morning", "custom_1_night"]'::jsonb,
      'customTimings', jsonb_build_array(
        jsonb_build_object('id', 'custom_1_night', 'label', '前一晚', 'builtin', false)
      )
    ),
    'Phase 1 與 Phase 2B 共用同一筆'
  );
  if v_saved->>'message_template' is distinct from 'Phase 1 與 Phase 2B 共用同一筆' then
    raise exception 'Phase 1 upsert failed: %', v_saved;
  end if;

  select * into v_rule
  from public.line_automation_rules
  where organization_id = 'org-the-enjoye'
    and automation_id = 'appointment_reminder';
  if v_rule.timing_ids is distinct from array['day_before_morning']::text[] then
    raise exception 'appointment_reminder timing_ids should keep only Phase 2B catalog values: %', v_rule.timing_ids;
  end if;
  if v_rule.timing_config->'customTimings'->0->>'id' is distinct from 'custom_1_night' then
    raise exception 'Phase 1 customTimings were not stored: %', v_rule.timing_config;
  end if;
  if v_rule.template is distinct from 'Phase 1 與 Phase 2B 共用同一筆' then
    raise exception 'Phase 1 did not dual-write template';
  end if;

  select status into v_keep from public.line_automation_jobs where id = 'laj-keep-day';
  select status into v_removed from public.line_automation_jobs where id = 'laj-remove-hours';
  select status into v_other from public.line_automation_jobs where id = 'laj-other-appt';
  if v_keep is distinct from 'scheduled' then
    raise exception 'kept timing job was canceled: %', v_keep;
  end if;
  if v_removed is distinct from 'canceled' then
    raise exception 'removed timing job was not canceled: %', v_removed;
  end if;
  if v_other is distinct from 'scheduled' then
    raise exception 'other appointment job with a still-selected timing was canceled: %', v_other;
  end if;

  v_workspace := public.read_line_appointment_reminder_workspace('org-the-enjoye');
  if v_workspace->>'template' is distinct from 'Phase 1 與 Phase 2B 共用同一筆' then
    raise exception 'Phase 2B read cannot see the shared Phase 1 row: %', v_workspace;
  end if;
  if v_workspace->'timing_ids' is distinct from '["day_before_morning"]'::jsonb then
    raise exception 'Phase 2B read saw unexpected timing_ids: %', v_workspace;
  end if;

  perform public.upsert_line_appointment_reminder_rule(
    'org-the-enjoye',
    true,
    array['day_before_morning', 'hours_before_3']::text[],
    'Phase 2B 寫回共用列',
    'staff-enjoye-owner'
  );

  select * into v_rule
  from public.line_automation_rules
  where organization_id = 'org-the-enjoye'
    and automation_id = 'appointment_reminder';
  if v_rule.template is distinct from 'Phase 2B 寫回共用列' then
    raise exception 'Phase 2B upsert did not update the shared row';
  end if;
  if v_rule.message_template is distinct from 'Phase 2B 寫回共用列' then
    raise exception 'trigger did not copy Phase 2B template into message_template';
  end if;
  if v_rule.timing_config->'customTimings'->0->>'id' is distinct from 'custom_1_night' then
    raise exception 'Phase 2B timing_ids write overwrote customTimings: %', v_rule.timing_config;
  end if;
  if not (v_rule.timing_config->'selectedTimingIds' ? 'custom_1_night') then
    raise exception 'Phase 2B timing_ids write dropped custom selection: %', v_rule.timing_config;
  end if;
  if not (v_rule.timing_config->'selectedTimingIds' ? 'hours_before_3') then
    raise exception 'Phase 2B timing_ids write did not restore catalog selection: %', v_rule.timing_config;
  end if;

  v_saved := public.set_line_automation_enabled(
    'org-the-enjoye',
    'appointment_reminder',
    false
  );
  if v_saved->>'enabled' is distinct from 'false' then
    raise exception 'set_line_automation_enabled did not disable the shared row';
  end if;
  if exists (
    select 1 from public.line_automation_jobs
    where organization_id = 'org-the-enjoye' and status = 'scheduled'
  ) then
    raise exception 'disabling the appointment rule left scheduled jobs';
  end if;

  insert into public.line_automation_jobs (
    id, organization_id, appointment_app_id, customer_app_id, service_app_id,
    timing_id, fingerprint, scheduled_for, status, request_id
  ) values (
    'laj-reenable', 'org-the-enjoye', 'appt-reenable', 'cust-3', 'svc-1',
    'day_before_morning', 'fp-reenable', now() + interval '1 day',
    'scheduled', 'larq-reenable'
  );

  v_saved := public.set_line_automation_enabled(
    'org-the-enjoye',
    'appointment_reminder',
    true
  );
  if v_saved->>'enabled' is distinct from 'true' then
    raise exception 're-enable failed: %', v_saved;
  end if;
  select status into v_keep from public.line_automation_jobs where id = 'laj-reenable';
  if v_keep is distinct from 'scheduled' then
    raise exception 're-enable canceled an existing scheduled job';
  end if;

  v_sync := public.sync_line_appointment_reminder_jobs('org-the-enjoye', 'appt-reenable');
  if v_sync->>'rule_enabled' is distinct from 'true' then
    raise exception 'Phase 2B sync did not see the re-enabled shared rule: %', v_sync;
  end if;
  select status into v_keep from public.line_automation_jobs where id = 'laj-reenable';
  if v_keep is distinct from 'canceled' then
    raise exception 'Phase 2B sync should cancel jobs for that appointment after a rewrite';
  end if;

  v_saved := public.upsert_line_automation_rule(
    'org-the-enjoye',
    'birthday_greeting',
    false,
    jsonb_build_object(
      'selectedTimingIds', '["birthday_morning"]'::jsonb,
      'customTimings', '[]'::jsonb
    ),
    '生日問候測試'
  );
  if v_saved->>'automation_type' is distinct from 'birthday_greeting' then
    raise exception 'birthday rule insert failed: %', v_saved;
  end if;

  select count(*) into v_rule_count
  from public.line_automation_rules
  where organization_id = 'org-the-enjoye';
  if v_rule_count <> 2 then
    raise exception 'expected two rules after birthday insert, found %', v_rule_count;
  end if;

  select * into v_rule
  from public.line_automation_rules
  where organization_id = 'org-the-enjoye'
    and automation_id = 'appointment_reminder';
  if v_rule.template is distinct from 'Phase 2B 寫回共用列' then
    raise exception 'birthday insert mutated the appointment reminder row';
  end if;
end;
$$;
