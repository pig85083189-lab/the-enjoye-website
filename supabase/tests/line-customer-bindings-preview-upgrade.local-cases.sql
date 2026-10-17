-- Local-only assertions after 161000 upgrades the actual Preview leftover schema.
-- Never connect to Preview or Production. Never call LINE.

create or replace function tests.assert_function_in_args(
  p_name text,
  p_identity_args text,
  p_argnames text[]
)
returns void
language plpgsql
as $$
declare
  v_names text[];
begin
  select p.proargnames[1:p.pronargs]
  into v_names
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = p_name
    and oidvectortypes(p.proargtypes) = p_identity_args;
  if not found then
    raise exception 'upgraded function missing: %(%)', p_name, p_identity_args;
  end if;
  if v_names is distinct from p_argnames then
    raise exception 'upgraded function kept leftover parameter names: %(%) %', p_name, p_identity_args, v_names;
  end if;
end;
$$;

create or replace function tests.assert_preview_job_rule_counts()
returns void
language plpgsql
as $$
declare
  v_job_count integer;
  v_rule_count integer;
begin
  select count(*) into v_job_count from public.line_automation_jobs;
  select count(*) into v_rule_count from public.line_automation_rules;
  if v_job_count <> 11 then
    raise exception 'upgrade changed job count: %', v_job_count;
  end if;
  if v_rule_count <> 1 then
    raise exception 'upgrade changed rule count: %', v_rule_count;
  end if;
  if not exists (
    select 1 from public.line_automation_jobs
    where id = 'laj-ready-day'
      and organization_id = 'org-beauty-os-test'
      and customer_app_id = 'cust-2d2-fake-bound'
  ) then
    raise exception 'leftover job identity was rewritten';
  end if;
  if not exists (
    select 1 from public.line_automation_rules
    where organization_id = 'org-beauty-os-test'
      and automation_id = 'appointment_reminder'
      and template = '舊預約提醒範本，請勿覆蓋'
  ) then
    raise exception 'leftover rule identity was rewritten';
  end if;
end;
$$;

do $$
declare
  v_binding public.line_customer_bindings%rowtype;
  v_binding_count integer;
  v_challenge_count integer;
  v_secret_count integer;
  v_ready_count integer;
  v_expected_id text;
  v_workspace jsonb;
  v_sync jsonb;
  v_apply jsonb;
  v_started jsonb;
  v_consumed jsonb;
  v_confirm jsonb;
  v_cancel jsonb;
  v_read jsonb;
  v_code text;
  v_hash text;
  v_rebind_hash text;
  v_hmac_key text := repeat('ab', 32);
  v_proof text;
  v_issued timestamptz;
  v_status text;
  v_legacy_start_args integer;
  v_legacy_consume_args integer;
  v_pk_cols name[];
begin
  select count(*) into v_binding_count from public.line_customer_bindings;
  select count(*) into v_challenge_count from public.line_customer_bind_challenges;
  if v_binding_count <> 1 then
    raise exception 'upgrade changed binding count: %', v_binding_count;
  end if;
  if v_challenge_count <> 0 then
    raise exception 'upgrade changed challenge count: %', v_challenge_count;
  end if;
  perform tests.assert_preview_job_rule_counts();

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_customer_bindings' and column_name = 'id'
  ) then
    raise exception 'upgrade did not add bindings.id';
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

  select array_agg(a.attname order by k.ord)
  into v_pk_cols
  from pg_constraint c
  join unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = 'public.line_customer_bindings'::regclass
    and c.contype = 'p';
  if v_pk_cols is distinct from array['organization_id', 'customer_app_id']::name[] then
    raise exception 'upgrade changed leftover primary key: %', v_pk_cols;
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
  if pg_get_constraintdef((
    select oid from pg_constraint
    where conname = 'line_customer_bind_challenges_id_prefix'
      and conrelid = 'public.line_customer_bind_challenges'::regclass
  )) !~ 'lcc-%' then
    raise exception 'upgrade dropped leftover lcc- challenge id compatibility';
  end if;
  if to_regclass('public.line_customer_binding_secrets') is null
     or to_regclass('public.line_customer_binding_rebinds') is null
     or to_regclass('public.line_customer_bind_challenge_secrets') is null then
    raise exception 'upgrade did not create secrets or rebinds tables';
  end if;

  v_expected_id := 'lcb-' || substr(md5('org-beauty-os-test:cust-2d2-fake-bound'), 1, 20);
  select * into v_binding
  from public.line_customer_bindings
  where organization_id = 'org-beauty-os-test'
    and customer_app_id = 'cust-2d2-fake-bound';
  if not found then
    raise exception 'upgrade lost the leftover binding row';
  end if;
  if v_binding.id is distinct from v_expected_id then
    raise exception 'upgrade did not generate the stable leftover id: % expected %', v_binding.id, v_expected_id;
  end if;
  if v_binding.customer_id is distinct from 'cust-2d2-fake-bound' then
    raise exception 'upgrade lost customer identity: %', v_binding.customer_id;
  end if;
  if v_binding.customer_uuid is distinct from 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid then
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
  where binding_id = v_expected_id
    and organization_id = 'org-beauty-os-test'
    and line_user_id_cipher = 'v1.cipher-preview-legacy';
  if v_secret_count <> 1 then
    raise exception 'legacy cipher was not copied into secrets: %', v_secret_count;
  end if;

  if public.line_automation_schedule_recipient_ready('org-beauty-os-test', 'cust-2d2-fake-bound')
     or public.line_automation_send_recipient_allowed('org-beauty-os-test', 'cust-2d2-fake-bound') then
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

  perform tests.assert_function_in_args(
    'unbind_line_customer_binding',
    'text, text',
    array['p_organization_id', 'p_customer_id']::text[]
  );
  perform tests.assert_function_in_args(
    'confirm_line_customer_binding',
    'text, text',
    array['p_organization_id', 'p_customer_id']::text[]
  );
  perform tests.assert_function_in_args(
    'line_customer_binding_resolve',
    'text, text',
    array['p_organization_id', 'p_customer_id']::text[]
  );
  perform tests.assert_function_in_args(
    'line_automation_send_recipient_allowed',
    'text, text',
    array['p_organization_id', 'p_customer_id']::text[]
  );
  perform tests.assert_function_in_args(
    'line_automation_schedule_recipient_ready',
    'text, text',
    array['p_organization_id', 'p_customer_id']::text[]
  );
  if to_regprocedure('public.upsert_line_appointment_reminder_rule(text, boolean, text[], text, text)') is null
     or to_regprocedure('public.read_line_appointment_reminder_workspace(text)') is null
     or to_regprocedure('public.sync_line_appointment_reminder_jobs(text, text)') is null
     or to_regprocedure('public.apply_line_automation_schedule(text, jsonb)') is null then
    raise exception 'upgrade dropped Phase 2A or reminder RPCs';
  end if;

  perform tests.become('11111111-1111-1111-1111-111111111111');

  v_workspace := public.read_line_appointment_reminder_workspace('org-beauty-os-test');
  if v_workspace->>'template' is distinct from '舊預約提醒範本，請勿覆蓋' then
    raise exception 'Phase 2B reminder read lost the leftover rule: %', v_workspace;
  end if;
  v_sync := public.sync_line_appointment_reminder_jobs('org-beauty-os-test', 'appt-keep');
  if v_sync->>'rule_enabled' is distinct from 'true' then
    raise exception 'Phase 2B sync lost the leftover rule: %', v_sync;
  end if;
  v_apply := public.apply_line_automation_schedule(
    'org-beauty-os-test',
    jsonb_build_object(
      'organization_id', 'org-beauty-os-test',
      'insert', '[]'::jsonb,
      'update', '[]'::jsonb,
      'cancel', '[]'::jsonb
    )
  );
  if v_apply is null then
    raise exception 'Phase 2A apply_line_automation_schedule is missing after bind upgrade';
  end if;

  begin
    v_confirm := public.confirm_line_customer_binding('org-beauty-os-test', 'cust-2d2-fake-bound');
    raise exception 'legacy pending row was confirmed without a new capture: %', v_confirm;
  exception
    when invalid_parameter_value then
      null;
  end;
  if public.line_automation_schedule_recipient_ready('org-beauty-os-test', 'cust-2d2-fake-bound') then
    raise exception 'confirm without captured_at produced recipient_ready';
  end if;
  perform tests.assert_preview_job_rule_counts();

  -- First bind for a customer with no leftover row.
  v_started := public.start_line_customer_bind_challenge(
    'org-beauty-os-test', 'cust-unbound', true, v_hmac_key
  );
  v_code := v_started->>'code';
  if v_code is null or v_started->>'challenge_id' not like 'lcbc-%' then
    raise exception 'first bind start after upgrade failed: %', v_started;
  end if;
  v_hash := encode(sha256(convert_to('Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'utf8')), 'hex');
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-beauty-os-test', 'token-local', 'evt-first-1', v_code, v_hash,
    'v1.cipher-first', '••••bbbb', 'line-cred-v1', v_hmac_key, v_issued
  );
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-beauty-os-test', 'evt-first-1', false);
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-beauty-os-test', 'token-local', v_code, 'evt-first-1', v_proof, v_issued,
    'v1.cipher-first', '••••bbbb', v_hash, 'line-cred-v1'
  );
  if (v_consumed->>'captured')::boolean is not true then
    raise exception 'first bind consume failed: %', v_consumed;
  end if;
  if public.line_automation_schedule_recipient_ready('org-beauty-os-test', 'cust-unbound') then
    raise exception 'first bind pending capture was treated as trusted';
  end if;
  v_confirm := public.confirm_line_customer_binding('org-beauty-os-test', 'cust-unbound');
  if v_confirm->>'verified' is distinct from 'true'
     or public.line_automation_schedule_recipient_ready('org-beauty-os-test', 'cust-unbound') is not true then
    raise exception 'first bind confirm failed: %', v_confirm;
  end if;
  v_cancel := public.unbind_line_customer_binding('org-beauty-os-test', 'cust-unbound');
  if v_cancel->>'verified' is distinct from 'false'
     or public.line_automation_schedule_recipient_ready('org-beauty-os-test', 'cust-unbound') then
    raise exception 'upgraded unbind failed: %', v_cancel;
  end if;
  if not exists (
    select 1 from public.line_customer_bindings
    where organization_id = 'org-beauty-os-test'
      and customer_app_id = 'cust-2d2-fake-bound'
      and customer_id = 'cust-2d2-fake-bound'
  ) then
    raise exception 'unbind of first bind removed the leftover binding';
  end if;
  perform tests.assert_preview_job_rule_counts();

  -- Re-verify leftover customer, then rebind and cancel.
  v_started := public.start_line_customer_bind_challenge(
    'org-beauty-os-test', 'cust-2d2-fake-bound', true, v_hmac_key
  );
  v_code := v_started->>'code';
  v_hash := encode(sha256(convert_to('Ucccccccccccccccccccccccccccccccc', 'utf8')), 'hex');
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-beauty-os-test', 'token-local', 'evt-reverify-1', v_code, v_hash,
    'v1.cipher-reverify', '••••cccc', 'line-cred-v1', v_hmac_key, v_issued
  );
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-beauty-os-test', 'evt-reverify-1', false);
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-beauty-os-test', 'token-local', v_code, 'evt-reverify-1', v_proof, v_issued,
    'v1.cipher-reverify', '••••cccc', v_hash, 'line-cred-v1'
  );
  if (v_consumed->>'captured')::boolean is not true then
    raise exception 'leftover re-verify consume failed: %', v_consumed;
  end if;
  v_confirm := public.confirm_line_customer_binding('org-beauty-os-test', 'cust-2d2-fake-bound');
  if public.line_automation_schedule_recipient_ready('org-beauty-os-test', 'cust-2d2-fake-bound') is not true then
    raise exception 'leftover re-verify did not become trusted: %', v_confirm;
  end if;
  if not exists (
    select 1 from public.line_customer_bindings
    where id = v_expected_id
      and organization_id = 'org-beauty-os-test'
      and customer_app_id = 'cust-2d2-fake-bound'
      and customer_id = 'cust-2d2-fake-bound'
  ) then
    raise exception 're-verify replaced the leftover binding identity';
  end if;

  v_started := public.start_line_customer_bind_challenge(
    'org-beauty-os-test', 'cust-2d2-fake-bound', true, v_hmac_key
  );
  v_code := v_started->>'code';
  v_rebind_hash := encode(sha256(convert_to('Udddddddddddddddddddddddddddddddd', 'utf8')), 'hex');
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-beauty-os-test', 'token-local', 'evt-rebind-1', v_code, v_rebind_hash,
    'v1.cipher-rebind', '••••dddd', 'line-cred-v1', v_hmac_key, v_issued
  );
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-beauty-os-test', 'evt-rebind-1', false);
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-beauty-os-test', 'token-local', v_code, 'evt-rebind-1', v_proof, v_issued,
    'v1.cipher-rebind', '••••dddd', v_rebind_hash, 'line-cred-v1'
  );
  if (v_consumed->>'rebind')::boolean is not true then
    raise exception 'rebind consume did not stage a replacement: %', v_consumed;
  end if;
  if exists (
    select 1 from public.line_customer_bindings
    where id = v_expected_id and line_user_id_hash = v_rebind_hash
  ) then
    raise exception 'pending rebind overwrote the active leftover binding';
  end if;
  v_cancel := public.cancel_line_customer_rebind('org-beauty-os-test', 'cust-2d2-fake-bound');
  if v_cancel->>'canceled' is distinct from 'true' then
    raise exception 'rebind cancel failed: %', v_cancel;
  end if;
  if exists (
    select 1 from public.line_customer_binding_rebinds where binding_id = v_expected_id
  ) then
    raise exception 'rebind cancel left a staged identity';
  end if;
  if public.line_automation_schedule_recipient_ready('org-beauty-os-test', 'cust-2d2-fake-bound') is not true
     or exists (
       select 1 from public.line_customer_bindings
       where id = v_expected_id and line_user_id_hash is distinct from v_hash
     ) then
    raise exception 'rebind cancel mutated the trusted leftover binding';
  end if;
  perform tests.assert_preview_job_rule_counts();

  -- Cross-org isolation.
  perform tests.become('33333333-3333-3333-3333-333333333333');
  begin
    v_started := public.start_line_customer_bind_challenge(
      'org-beauty-os-test', 'cust-2d2-fake-bound', true, v_hmac_key
    );
    raise exception 'cross-org customer bind was accepted: %', v_started;
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    v_confirm := public.confirm_line_customer_binding('org-beauty-os-test', 'cust-2d2-fake-bound');
    raise exception 'cross-org confirm was accepted: %', v_confirm;
  exception
    when insufficient_privilege then
      null;
  end;
  v_read := public.read_line_customer_bindings('org-the-enjoye');
  if v_read::text like '%cust-2d2-fake-bound%' or v_read::text like '%••••cccc%' then
    raise exception 'cross-org read leaked the leftover binding: %', v_read;
  end if;
  if public.line_automation_schedule_recipient_ready('org-the-enjoye', 'cust-2d2-fake-bound')
     or public.line_automation_send_recipient_allowed('org-the-enjoye', 'cust-2d2-fake-bound') then
    raise exception 'cross-org recipient_ready leaked the leftover customer';
  end if;
  perform tests.assert_preview_job_rule_counts();
end;
$$;
