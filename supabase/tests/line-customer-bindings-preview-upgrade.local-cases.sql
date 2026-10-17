-- Local-only assertions after 161000 upgrades the Preview leftover bind schema.
-- Never connect to Preview or Production. Never call LINE.

do $$
declare
  v_binding public.line_customer_bindings%rowtype;
  v_binding_count integer;
  v_challenge_count integer;
  v_job_count integer;
  v_rule_count integer;
  v_secret_count integer;
  v_ready_count integer;
  v_workspace jsonb;
  v_sync jsonb;
  v_apply jsonb;
  v_started jsonb;
  v_consumed jsonb;
  v_confirm jsonb;
  v_code text;
  v_hash text;
  v_hmac_key text := repeat('ab', 32);
  v_proof text;
  v_issued timestamptz;
  v_status text;
  v_legacy_start_args integer;
  v_legacy_consume_args integer;
begin
  select count(*) into v_binding_count from public.line_customer_bindings;
  select count(*) into v_challenge_count from public.line_customer_bind_challenges;
  select count(*) into v_job_count from public.line_automation_jobs;
  select count(*) into v_rule_count from public.line_automation_rules;
  if v_binding_count <> 1 then
    raise exception 'upgrade changed binding count: %', v_binding_count;
  end if;
  if v_challenge_count <> 0 then
    raise exception 'upgrade changed challenge count: %', v_challenge_count;
  end if;
  if v_job_count <> 11 then
    raise exception 'upgrade changed job count: %', v_job_count;
  end if;
  if v_rule_count <> 1 then
    raise exception 'upgrade changed rule count: %', v_rule_count;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_customer_bindings' and column_name = 'customer_app_id'
  ) then
    raise exception 'upgrade dropped customer_app_id';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_customer_bindings' and column_name = 'line_user_id_cipher'
  ) then
    raise exception 'upgrade dropped on-table cipher';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_customer_bind_challenges' and column_name = 'customer_app_id'
  ) then
    raise exception 'upgrade dropped challenge customer_app_id';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_customer_bind_challenges' and column_name = 'identity_confirmed_at'
  ) then
    raise exception 'upgrade did not add challenge identity_confirmed_at';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_customer_bind_challenges' and column_name = 'consumed_event_id'
  ) then
    raise exception 'upgrade did not add challenge consumed_event_id';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_customer_bind_challenges' and column_name = 'consumed_proof_hash'
  ) then
    raise exception 'upgrade did not add challenge consumed_proof_hash';
  end if;
  if to_regclass('public.line_customer_binding_secrets') is null
     or to_regclass('public.line_customer_binding_rebinds') is null
     or to_regclass('public.line_customer_bind_challenge_secrets') is null then
    raise exception 'upgrade did not create secrets or rebinds tables';
  end if;

  select * into v_binding
  from public.line_customer_bindings
  where id = 'lcb-preview-legacy-1';
  if not found then
    raise exception 'upgrade lost the leftover binding row';
  end if;
  if v_binding.organization_id is distinct from 'org-the-enjoye' then
    raise exception 'upgrade lost organization identity: %', v_binding.organization_id;
  end if;
  if v_binding.customer_app_id is distinct from 'cust-1'
     or v_binding.customer_id is distinct from 'cust-1' then
    raise exception 'upgrade lost customer identity: app=% id=%', v_binding.customer_app_id, v_binding.customer_id;
  end if;
  if v_binding.customer_uuid is distinct from 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid then
    raise exception 'upgrade lost customer uuid: %', v_binding.customer_uuid;
  end if;
  if v_binding.line_user_id_cipher is distinct from 'v1.cipher-preview-legacy' then
    raise exception 'upgrade lost on-table cipher: %', v_binding.line_user_id_cipher;
  end if;
  if v_binding.verified is true
     or v_binding.status is distinct from 'pending'
     or v_binding.confirmed_at is not null
     or v_binding.confirmed_by is not null
     or v_binding.captured_at is not null
     or v_binding.bound_at is not null then
    raise exception 'legacy verified row was treated as a new trusted recipient: %', v_binding;
  end if;

  select count(*) into v_secret_count
  from public.line_customer_binding_secrets
  where binding_id = 'lcb-preview-legacy-1'
    and organization_id = 'org-the-enjoye'
    and line_user_id_cipher = 'v1.cipher-preview-legacy';
  if v_secret_count <> 1 then
    raise exception 'legacy cipher was not copied into secrets: %', v_secret_count;
  end if;

  if public.line_automation_schedule_recipient_ready('org-the-enjoye', 'cust-1')
     or public.line_automation_send_recipient_allowed('org-the-enjoye', 'cust-1') then
    raise exception 'legacy verified row became recipient_ready without new verification';
  end if;

  select count(*) into v_ready_count
  from public.line_automation_jobs
  where recipient_ready is true;
  if v_ready_count <> 0 then
    raise exception 'leftover jobs kept recipient_ready=true: %', v_ready_count;
  end if;

  select status into v_status from public.line_automation_jobs where id = 'laj-ready-day';
  if v_status is distinct from 'pending_recipient' then
    raise exception 'scheduled leftover ready job was not demoted: %', v_status;
  end if;
  select status into v_status from public.line_automation_jobs where id = 'laj-ready-hours';
  if v_status is distinct from 'pending_recipient' then
    raise exception 'second scheduled leftover ready job was not demoted: %', v_status;
  end if;
  select status into v_status from public.line_automation_jobs where id = 'laj-sched-false';
  if v_status is distinct from 'scheduled' then
    raise exception 'non-ready scheduled job was rewritten: %', v_status;
  end if;
  select status into v_status from public.line_automation_jobs where id = 'laj-claimed';
  if v_status is distinct from 'claimed' then
    raise exception 'claimed leftover job status was rewritten: %', v_status;
  end if;
  if exists (
    select 1 from public.line_automation_jobs
    where id in (
      'laj-accepted', 'laj-canceled', 'laj-skipped', 'laj-failed',
      'laj-pending-conf', 'laj-reconciled', 'laj-expired'
    )
      and status is distinct from case id
        when 'laj-accepted' then 'accepted'
        when 'laj-canceled' then 'canceled'
        when 'laj-skipped' then 'skipped'
        when 'laj-failed' then 'failed'
        when 'laj-pending-conf' then 'pending_confirmation'
        when 'laj-reconciled' then 'reconciled'
        when 'laj-expired' then 'expired'
      end
  ) then
    raise exception 'terminal leftover job statuses were rewritten';
  end if;

  select count(*) into v_legacy_start_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'start_line_customer_bind_challenge'
    and p.pronargs = 2;
  if v_legacy_start_args <> 0 then
    raise exception 'legacy 2-arg start RPC is still present';
  end if;
  select count(*) into v_legacy_consume_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'consume_line_customer_bind_challenge_public'
    and p.pronargs = 7;
  if v_legacy_consume_args <> 0 then
    raise exception 'legacy 7-arg consume RPC is still present';
  end if;

  perform tests.become('11111111-1111-1111-1111-111111111111');

  v_workspace := public.read_line_appointment_reminder_workspace('org-the-enjoye');
  if v_workspace->>'template' is distinct from '舊預約提醒範本，請勿覆蓋' then
    raise exception 'Phase 2B reminder read lost the leftover rule: %', v_workspace;
  end if;
  if v_workspace->>'enabled' is distinct from 'true' then
    raise exception 'Phase 2B reminder read lost enabled';
  end if;

  v_sync := public.sync_line_appointment_reminder_jobs('org-the-enjoye', 'appt-keep');
  if v_sync->>'rule_enabled' is distinct from 'true' then
    raise exception 'Phase 2B sync lost the leftover rule: %', v_sync;
  end if;

  v_apply := public.apply_line_automation_schedule(
    'org-the-enjoye',
    jsonb_build_object(
      'organization_id', 'org-the-enjoye',
      'insert', '[]'::jsonb,
      'update', '[]'::jsonb,
      'cancel', '[]'::jsonb
    )
  );
  if v_apply is null then
    raise exception 'Phase 2A apply_line_automation_schedule is missing after bind upgrade';
  end if;

  begin
    v_confirm := public.confirm_line_customer_binding('org-the-enjoye', 'cust-1');
    raise exception 'legacy pending row was confirmed without a new capture: %', v_confirm;
  exception
    when invalid_parameter_value then
      null;
  end;
  if public.line_automation_schedule_recipient_ready('org-the-enjoye', 'cust-1') then
    raise exception 'confirm without captured_at produced recipient_ready';
  end if;

  v_started := public.start_line_customer_bind_challenge(
    'org-the-enjoye', 'cust-1', true, v_hmac_key
  );
  v_code := v_started->>'code';
  if v_code is null then
    raise exception 'new start after upgrade failed: %', v_started;
  end if;
  v_hash := encode(sha256(convert_to('Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'utf8')), 'hex');
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-the-enjoye', 'token-local', 'evt-upgrade-1', v_code, v_hash,
    'v1.cipher-upgrade-new', '••••bbbb', 'line-cred-v1', v_hmac_key, v_issued
  );
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-the-enjoye', 'evt-upgrade-1', false);

  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    'evt-upgrade-1',
    v_proof,
    v_issued,
    'v1.cipher-upgrade-new',
    '••••bbbb',
    v_hash,
    'line-cred-v1'
  );
  if (v_consumed->>'captured')::boolean is not true then
    raise exception 'new consume after upgrade failed: %', v_consumed;
  end if;
  if public.line_automation_schedule_recipient_ready('org-the-enjoye', 'cust-1') then
    raise exception 'pending capture after upgrade was treated as trusted';
  end if;

  v_confirm := public.confirm_line_customer_binding('org-the-enjoye', 'cust-1');
  if v_confirm->>'verified' is distinct from 'true' then
    raise exception 'new confirm after upgrade failed: %', v_confirm;
  end if;
  if public.line_automation_schedule_recipient_ready('org-the-enjoye', 'cust-1') is not true then
    raise exception 'new verified capture did not become recipient_ready';
  end if;

  select count(*) into v_binding_count from public.line_customer_bindings;
  if v_binding_count <> 1 then
    raise exception 'new capture created a second binding: %', v_binding_count;
  end if;
  if not exists (
    select 1 from public.line_customer_bindings
    where id = 'lcb-preview-legacy-1'
      and customer_id = 'cust-1'
      and organization_id = 'org-the-enjoye'
      and customer_app_id = 'cust-1'
  ) then
    raise exception 'new capture replaced the leftover binding identity';
  end if;
end;
$$;
