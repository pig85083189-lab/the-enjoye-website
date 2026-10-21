-- Local-only Phase 2B customer binding cases. Never call LINE.

do $$
declare
  v_code text;
  v_hash text;
  v_other_hash text;
  v_hmac_key text := repeat('ab', 32);
  v_proof text;
  v_issued timestamptz;
  v_ready boolean;
  v_status text;
  v_count int;
  v_secret int;
  v_job_id text;
  v_payload jsonb;
  v_update jsonb;
  v_other jsonb;
  v_started jsonb;
  v_consumed jsonb;
  v_event text;
begin
  perform tests.become('11111111-1111-1111-1111-111111111111');

  if not exists (
    select 1
    from public.line_automation_jobs
    where id = 'laj-keep-day'
      and organization_id = 'org-the-enjoye'
      and appointment_app_id = 'appt-keep'
      and customer_app_id = 'cust-1'
      and timing_id = 'day_before_morning'
      and fingerprint = 'org-the-enjoye|appointment_reminder|appt-keep|day_before_morning'
      and status = 'scheduled'
      and recipient_ready is false
  ) then
    raise exception 'Phase 2B appointment job was not preserved after customer bindings';
  end if;

  if public.line_automation_schedule_recipient_ready('org-the-enjoye', 'cust-1') then
    raise exception 'CRM line_user_id forged recipient_ready';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public.line_customer_bindings', 'select')
       or has_table_privilege('anon', 'public.line_customer_binding_secrets', 'select')
       or has_table_privilege('anon', 'public.line_customer_binding_rebinds', 'select')
       or has_table_privilege('anon', 'public.line_customer_bind_challenges', 'select')
       or has_table_privilege('anon', 'public.line_customer_bind_challenge_secrets', 'select') then
      raise exception 'anon can read customer binding tables';
    end if;
    if has_function_privilege(
      'authenticated',
      'public.consume_line_customer_bind_challenge_public(text,text,text,text,text,timestamptz,text,text,text,text)',
      'execute'
    ) then
      raise exception 'authenticated can execute public consume';
    end if;
  end if;

  v_payload := jsonb_build_object(
    'organization_id', 'org-the-enjoye',
    'insert', jsonb_build_array(
      jsonb_build_object(
        'organization_id', 'org-the-enjoye',
        'automation_type', 'birthday_greeting',
        'event_kind', 'customer_birthday',
        'event_id', 'cust-1',
        'customer_id', 'cust-1',
        'timing_id', 'birthday_morning',
        'fingerprint', 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning',
        'scheduled_for', public.line_automation_schedule_expected_fire_at(
          'org-the-enjoye', 'birthday_greeting', 'customer_birthday', 'cust-1', 'cust-1', 'birthday_morning'
        ),
        'message_snapshot', '生日快樂',
        'recipient_ready', true
      )
    ),
    'update', '[]'::jsonb,
    'cancel', '[]'::jsonb
  );
  perform public.apply_line_automation_schedule('org-the-enjoye', v_payload);
  select status, recipient_ready into v_status, v_ready
  from public.line_automation_jobs
  where fingerprint = 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning';
  if v_status is distinct from 'pending_recipient' or v_ready is not false then
    raise exception 'new job without trusted binding was scheduled: % %', v_status, v_ready;
  end if;

  begin
    perform tests.become('33333333-3333-3333-3333-333333333333');
    perform public.start_line_customer_bind_challenge(
      'org-the-enjoye', 'cust-1', true, v_hmac_key
    );
    raise exception 'staff bind start was accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform tests.become('22222222-2222-2222-2222-222222222222');
    perform public.start_line_customer_bind_challenge(
      'org-the-enjoye', 'cust-1', true, v_hmac_key
    );
    raise exception 'cross-org customer bind was accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  perform tests.become('11111111-1111-1111-1111-111111111111');
  begin
    perform public.start_line_customer_bind_challenge(
      'org-the-enjoye', 'cust-1', false, v_hmac_key
    );
    raise exception 'bind start without in-person confirmation was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  v_started := public.start_line_customer_bind_challenge(
    'org-the-enjoye', 'cust-1', true, v_hmac_key
  );
  v_code := v_started->>'code';
  if v_code is null or v_code !~ '^[0-9A-F]{8}$' then
    raise exception 'owner bind start did not return a one-time code';
  end if;
  if v_started ? 'line_user_id' or v_started ? 'hmac_key' then
    raise exception 'bind start leaked a LINE user id or server key';
  end if;

  v_hash := encode(sha256(convert_to('Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'utf8')), 'hex');
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    'evt-forged',
    'not-a-sha256-hash',
    now(),
    'v1.forged-not-from-webhook',
    '••••aaaa',
    v_hash,
    'line-cred-v1'
  );
  if coalesce((v_consumed->>'captured')::boolean, true)
     or coalesce((v_consumed->>'bound')::boolean, true) then
    raise exception 'anonymous consume without server proof was accepted';
  end if;

  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-the-enjoye', 'token-local', 'evt-forged-hash', v_code,
    repeat('00', 32), 'v1.forged-not-from-webhook', '••••aaaa', 'line-cred-v1',
    v_hmac_key, v_issued
  );
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-the-enjoye', 'evt-forged-hash', false);
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    'evt-forged-hash',
    v_proof,
    v_issued,
    'v1.forged-not-from-webhook',
    '••••aaaa',
    v_hash,
    'line-cred-v1'
  );
  if coalesce((v_consumed->>'captured')::boolean, true) then
    raise exception 'forged LINE identity was accepted';
  end if;

  v_started := public.start_line_customer_bind_challenge(
    'org-the-enjoye', 'cust-1', true, v_hmac_key
  );
  v_code := v_started->>'code';
  v_issued := now() - interval '3 minutes';
  v_proof := tests.line_customer_bind_proof(
    'org-the-enjoye', 'token-local', 'evt-expired-proof', v_code,
    v_hash, 'v1.cipher-expired', '••••aaaa', 'line-cred-v1', v_hmac_key, v_issued
  );
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye', 'token-local', v_code, 'evt-expired-proof', v_proof, v_issued,
    'v1.cipher-expired', '••••aaaa', v_hash, 'line-cred-v1'
  );
  if v_consumed->>'reason' is distinct from 'expired' then
    raise exception 'stale server proof was accepted: %', v_consumed;
  end if;

  update public.line_customer_bind_challenges
  set expires_at = now() - interval '1 second'
  where organization_id = 'org-the-enjoye'
    and customer_id = 'cust-1'
    and consumed_at is null;
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-the-enjoye', 'token-local', 'evt-expired-code', v_code,
    v_hash, 'v1.cipher-expired', '••••aaaa', 'line-cred-v1', v_hmac_key, v_issued
  );
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-the-enjoye', 'evt-expired-code', false);
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye', 'token-local', v_code, 'evt-expired-code', v_proof, v_issued,
    'v1.cipher-expired', '••••aaaa', v_hash, 'line-cred-v1'
  );
  if v_consumed->>'reason' is distinct from 'expired' then
    raise exception 'expired bind code was accepted: %', v_consumed;
  end if;

  v_started := public.start_line_customer_bind_challenge(
    'org-the-enjoye', 'cust-1', true, v_hmac_key
  );
  v_code := v_started->>'code';
  v_issued := now();
  for v_count in 1..5 loop
    update public.line_customer_bind_challenges
    set last_attempt_at = now() - interval '3 seconds'
    where organization_id = 'org-the-enjoye'
      and customer_id = 'cust-1'
      and consumed_at is null;
    v_consumed := public.consume_line_customer_bind_challenge_public(
      'org-the-enjoye',
      'token-local',
      v_code,
      'evt-attempts',
      repeat('ab', 32),
      v_issued,
      'v1.cipher-attempts',
      '••••aaaa',
      v_hash,
      'line-cred-v1'
    );
  end loop;
  if v_consumed->>'reason' is distinct from 'attempt_limited' then
    raise exception 'attempt limit was not enforced: %', v_consumed;
  end if;

  v_started := public.start_line_customer_bind_challenge(
    'org-the-enjoye', 'cust-1', true, v_hmac_key
  );
  v_code := v_started->>'code';
  v_issued := now();
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    'evt-throttle',
    repeat('cd', 32),
    v_issued,
    'v1.cipher-throttle',
    '••••aaaa',
    v_hash,
    'line-cred-v1'
  );
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    'evt-throttle',
    repeat('cd', 32),
    v_issued,
    'v1.cipher-throttle',
    '••••aaaa',
    v_hash,
    'line-cred-v1'
  );
  if v_consumed->>'reason' is distinct from 'throttled' then
    raise exception 'short throttle was not enforced: %', v_consumed;
  end if;

  v_started := public.start_line_customer_bind_challenge(
    'org-the-enjoye', 'cust-1', true, v_hmac_key
  );
  v_code := v_started->>'code';
  v_event := 'evt-cust-1';
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-the-enjoye', v_event, false);
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-the-enjoye', 'token-local', v_event, v_code,
    v_hash, 'v1.cipher-cust-1', '••••aaaa', 'line-cred-v1', v_hmac_key, v_issued
  );
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    v_event,
    v_proof,
    v_issued,
    'v1.swapped-cipher',
    '••••aaaa',
    v_hash,
    'line-cred-v1'
  );
  if coalesce((v_consumed->>'captured')::boolean, true) then
    raise exception 'cipher substitution was accepted: %', v_consumed;
  end if;
  update public.line_customer_bind_challenges
  set last_attempt_at = now() - interval '3 seconds'
  where organization_id = 'org-the-enjoye'
    and customer_id = 'cust-1'
    and consumed_at is null;
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    v_event,
    v_proof,
    v_issued,
    'v1.cipher-cust-1',
    '••••aaaa',
    v_hash,
    'line-cred-v1'
  );
  if (v_consumed->>'captured')::boolean is not true or (v_consumed->>'bound')::boolean is not false then
    raise exception 'webhook capture failed: %', v_consumed;
  end if;
  if v_consumed ? 'customer_id' or v_consumed ? 'hint' or v_consumed ? 'line_user_id' then
    raise exception 'public consume leaked customer identity: %', v_consumed;
  end if;
  if public.line_automation_schedule_recipient_ready('org-the-enjoye', 'cust-1')
     or public.line_automation_send_recipient_allowed('org-the-enjoye', 'cust-1') then
    raise exception 'pending capture was treated as trusted';
  end if;

  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    v_event,
    v_proof,
    v_issued,
    'v1.cipher-cust-1',
    '••••aaaa',
    v_hash,
    'line-cred-v1'
  );
  if coalesce((v_consumed->>'captured')::boolean, true) then
    raise exception 'replayed webhook event was accepted';
  end if;

  update public.line_customer_bindings
  set pending_expires_at = now() - interval '1 second'
  where organization_id = 'org-the-enjoye' and customer_id = 'cust-1';
  begin
    perform public.confirm_line_customer_binding('org-the-enjoye', 'cust-1');
    raise exception 'expired pending confirm was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;
  if public.line_automation_schedule_recipient_ready('org-the-enjoye', 'cust-1') then
    raise exception 'expired pending capture was treated as trusted';
  end if;
  if exists (
    select 1
    from public.line_customer_bindings
    where organization_id = 'org-the-enjoye'
      and customer_id = 'cust-1'
      and (verified is true or status is distinct from 'pending' or confirmed_at is not null)
  ) then
    raise exception 'expired pending confirm mutated trusted fields';
  end if;
  update public.line_customer_bindings
  set pending_expires_at = now() + interval '10 minutes'
  where organization_id = 'org-the-enjoye' and customer_id = 'cust-1';

  perform public.confirm_line_customer_binding('org-the-enjoye', 'cust-1');
  if public.line_automation_schedule_recipient_ready('org-the-enjoye', 'cust-1') is not true then
    raise exception 'confirmed binding did not confirm recipient_ready';
  end if;
  if exists (
    select 1
    from public.line_customer_bindings b
    left join public.line_customer_binding_secrets s on s.binding_id = b.id
    where b.organization_id = 'org-the-enjoye'
      and b.customer_id = 'cust-1'
      and (
        b.verified is not true
        or b.status is distinct from 'active'
        or b.confirmed_at is null
        or s.binding_id is null
      )
  ) then
    raise exception 'confirmed binding fields were inconsistent';
  end if;
  begin
    perform public.confirm_line_customer_binding('org-the-enjoye', 'cust-1');
    raise exception 'duplicate confirm was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  insert into public.line_customer_binding_rebinds (
    binding_id, organization_id, customer_id,
    line_user_id_hint, line_user_id_hash, line_user_id_cipher, key_id,
    captured_at, expires_at
  )
  select
    b.id, b.organization_id, b.customer_id,
    '••••zzzz',
    encode(sha256(convert_to('Uzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'utf8')), 'hex'),
    'v1.expired-rebind',
    'line-cred-v1',
    now(),
    now() - interval '1 second'
  from public.line_customer_bindings b
  where b.organization_id = 'org-the-enjoye' and b.customer_id = 'cust-1';
  v_payload := public.confirm_line_customer_binding('org-the-enjoye', 'cust-1');
  if v_payload->>'reason' is distinct from 'expired' then
    raise exception 'expired rebind confirm did not return expired: %', v_payload;
  end if;
  if exists (
    select 1 from public.line_customer_binding_rebinds
    where organization_id = 'org-the-enjoye' and customer_id = 'cust-1'
  ) then
    raise exception 'expired rebind was not purged after confirm';
  end if;
  if not exists (
    select 1
    from public.line_customer_bindings b
    join public.line_customer_binding_secrets s on s.binding_id = b.id
    where b.organization_id = 'org-the-enjoye'
      and b.customer_id = 'cust-1'
      and b.line_user_id_hash = v_hash
      and b.status = 'active'
      and b.verified is true
      and b.confirmed_at is not null
      and s.line_user_id_cipher = 'v1.cipher-cust-1'
  ) then
    raise exception 'expired rebind cleanup mutated the active binding';
  end if;

  insert into public.line_customer_binding_rebinds (
    binding_id, organization_id, customer_id,
    line_user_id_hint, line_user_id_hash, line_user_id_cipher, key_id,
    captured_at, expires_at
  )
  select
    b.id, b.organization_id, b.customer_id,
    '••••yyyy',
    encode(sha256(convert_to('Uyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', 'utf8')), 'hex'),
    'v1.purge-rebind',
    'line-cred-v1',
    now(),
    now() - interval '2 seconds'
  from public.line_customer_bindings b
  where b.organization_id = 'org-the-enjoye' and b.customer_id = 'cust-1';
  if public.line_customer_binding_purge_expired('org-the-enjoye') < 1 then
    raise exception 'expired rebind purge deleted nothing';
  end if;
  if exists (
    select 1 from public.line_customer_binding_rebinds
    where organization_id = 'org-the-enjoye' and customer_id = 'cust-1'
  ) then
    raise exception 'expired rebind survived purge';
  end if;
  if not exists (
    select 1
    from public.line_customer_bindings
    where organization_id = 'org-the-enjoye'
      and customer_id = 'cust-1'
      and line_user_id_hash = v_hash
      and status = 'active'
      and verified is true
      and confirmed_at is not null
  ) then
    raise exception 'expired rebind purge mutated the active binding';
  end if;

  select id into v_job_id
  from public.line_automation_jobs
  where fingerprint = 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning';
  v_update := jsonb_build_object(
    'organization_id', 'org-the-enjoye',
    'insert', '[]'::jsonb,
    'update', jsonb_build_array(
      jsonb_build_object(
        'id', v_job_id,
        'organization_id', 'org-the-enjoye',
        'automation_type', 'birthday_greeting',
        'event_kind', 'customer_birthday',
        'event_id', 'cust-1',
        'customer_id', 'cust-1',
        'timing_id', 'birthday_morning',
        'fingerprint', 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning',
        'scheduled_for', public.line_automation_schedule_expected_fire_at(
          'org-the-enjoye', 'birthday_greeting', 'customer_birthday', 'cust-1', 'cust-1', 'birthday_morning'
        ),
        'message_snapshot', '生日快樂',
        'recipient_ready', true
      )
    ),
    'cancel', '[]'::jsonb
  );
  perform public.apply_line_automation_schedule('org-the-enjoye', v_update);
  select status, recipient_ready into v_status, v_ready
  from public.line_automation_jobs
  where fingerprint = 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning';
  if v_status is distinct from 'scheduled' or v_ready is not true then
    raise exception 'trusted binding did not promote pending job: % %', v_status, v_ready;
  end if;

  if not exists (
    select 1
    from public.line_automation_jobs
    where id = 'laj-keep-day'
      and status = 'scheduled'
      and appointment_app_id = 'appt-keep'
      and customer_app_id = 'cust-1'
  ) then
    raise exception 'Phase 2B appointment job lost original identity after trusted bind';
  end if;

  v_started := public.start_line_customer_bind_challenge(
    'org-the-enjoye', 'cust-2', true, v_hmac_key
  );
  v_code := v_started->>'code';
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-the-enjoye', 'evt-cust-2', false);
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-the-enjoye', 'token-local', 'evt-cust-2', v_code,
    v_hash, 'v1.cipher-cust-2', '••••aaaa', 'line-cred-v1', v_hmac_key, v_issued
  );
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    'evt-cust-2',
    v_proof,
    v_issued,
    'v1.cipher-cust-2',
    '••••aaaa',
    v_hash,
    'line-cred-v1'
  );
  if coalesce((v_consumed->>'captured')::boolean, true) or v_consumed->>'reason' is distinct from 'duplicate' then
    raise exception 'duplicate LINE identity was accepted: %', v_consumed;
  end if;

  perform tests.become('22222222-2222-2222-2222-222222222222');
  v_started := public.start_line_customer_bind_challenge(
    'org-lumiere', 'cust-l', true, v_hmac_key
  );
  v_code := v_started->>'code';
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-lumiere', 'evt-lumiere', false);
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-lumiere', 'token-local', 'evt-lumiere', v_code,
    v_hash, 'v1.cipher-lumiere', '••••aaaa', 'line-cred-v1', v_hmac_key, v_issued
  );
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-lumiere',
    'token-local',
    v_code,
    'evt-lumiere',
    v_proof,
    v_issued,
    'v1.cipher-lumiere',
    '••••aaaa',
    v_hash,
    'line-cred-v1'
  );
  if coalesce((v_consumed->>'captured')::boolean, true) or v_consumed->>'reason' is distinct from 'duplicate' then
    raise exception 'cross-org duplicate LINE identity was accepted: %', v_consumed;
  end if;

  begin
    perform public.unbind_line_customer_binding('org-the-enjoye', 'cust-1');
    raise exception 'cross-org unbind was accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.confirm_line_customer_binding('org-the-enjoye', 'cust-1');
    raise exception 'cross-org confirm was accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  perform tests.become('11111111-1111-1111-1111-111111111111');

  v_other_hash := encode(sha256(convert_to('Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'utf8')), 'hex');
  v_started := public.start_line_customer_bind_challenge(
    'org-the-enjoye', 'cust-1', true, v_hmac_key
  );
  v_code := v_started->>'code';
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-the-enjoye', 'evt-rebind', false);
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-the-enjoye', 'token-local', 'evt-rebind', v_code,
    v_other_hash, 'v1.cipher-cust-1-rebind', '••••bbbb', 'line-cred-v1',
    v_hmac_key, v_issued
  );
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    'evt-rebind',
    v_proof,
    v_issued,
    'v1.cipher-cust-1-rebind',
    '••••bbbb',
    v_other_hash,
    'line-cred-v1'
  );
  if (v_consumed->>'captured')::boolean is not true then
    raise exception 'same-customer rebind failed: %', v_consumed;
  end if;
  if exists (
    select 1
    from public.line_customer_bindings
    where organization_id = 'org-the-enjoye'
      and customer_id = 'cust-1'
      and (
        line_user_id_hash is distinct from v_hash
        or verified is not true
        or status is distinct from 'active'
        or confirmed_at is null
      )
  ) then
    raise exception 'pending rebind overwrote the active binding';
  end if;
  if not exists (
    select 1
    from public.line_customer_binding_secrets
    where organization_id = 'org-the-enjoye'
      and line_user_id_cipher = 'v1.cipher-cust-1'
  ) then
    raise exception 'pending rebind overwrote the active secret';
  end if;
  if not exists (
    select 1
    from public.line_customer_binding_rebinds
    where organization_id = 'org-the-enjoye'
      and customer_id = 'cust-1'
      and line_user_id_hash = v_other_hash
      and line_user_id_cipher = 'v1.cipher-cust-1-rebind'
  ) then
    raise exception 'pending rebind was not staged';
  end if;
  if public.line_automation_send_recipient_allowed('org-the-enjoye', 'cust-1') is not true then
    raise exception 'pending rebind dropped the trusted recipient';
  end if;

  perform public.cancel_line_customer_rebind('org-the-enjoye', 'cust-1');
  if exists (
    select 1 from public.line_customer_binding_rebinds
    where organization_id = 'org-the-enjoye' and customer_id = 'cust-1'
  ) then
    raise exception 'rebind cancel left a staged identity';
  end if;
  if not exists (
    select 1
    from public.line_customer_bindings b
    join public.line_customer_binding_secrets s on s.binding_id = b.id
    where b.organization_id = 'org-the-enjoye'
      and b.customer_id = 'cust-1'
      and b.line_user_id_hash = v_hash
      and b.status = 'active'
      and b.verified is true
      and b.confirmed_at is not null
      and s.line_user_id_cipher = 'v1.cipher-cust-1'
  ) then
    raise exception 'rebind cancel mutated the active binding';
  end if;

  v_started := public.start_line_customer_bind_challenge(
    'org-the-enjoye', 'cust-1', true, v_hmac_key
  );
  v_code := v_started->>'code';
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-the-enjoye', 'evt-rebind-confirm', false);
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-the-enjoye', 'token-local', 'evt-rebind-confirm', v_code,
    v_other_hash, 'v1.cipher-cust-1-rebind', '••••bbbb', 'line-cred-v1',
    v_hmac_key, v_issued
  );
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    'evt-rebind-confirm',
    v_proof,
    v_issued,
    'v1.cipher-cust-1-rebind',
    '••••bbbb',
    v_other_hash,
    'line-cred-v1'
  );
  if (v_consumed->>'captured')::boolean is not true then
    raise exception 'same-customer rebind failed: %', v_consumed;
  end if;
  perform public.confirm_line_customer_binding('org-the-enjoye', 'cust-1');
  select count(*) into v_count
  from public.line_customer_bindings
  where organization_id = 'org-the-enjoye' and customer_id = 'cust-1';
  if v_count <> 1 then
    raise exception 'rebind created a second binding row: %', v_count;
  end if;
  if exists (select 1 from public.line_customer_binding_rebinds) then
    raise exception 'confirmed rebind left a staged identity';
  end if;
  if not exists (
    select 1
    from public.line_customer_bindings b
    join public.line_customer_binding_secrets s on s.binding_id = b.id
    where b.organization_id = 'org-the-enjoye'
      and b.customer_id = 'cust-1'
      and b.line_user_id_hash = v_other_hash
      and b.status = 'active'
      and b.verified is true
      and b.confirmed_at is not null
      and s.line_user_id_cipher = 'v1.cipher-cust-1-rebind'
  ) then
    raise exception 'confirmed rebind did not switch identity atomically';
  end if;

  perform public.unbind_line_customer_binding('org-the-enjoye', 'cust-1');
  select count(*) into v_secret from public.line_customer_binding_secrets;
  if v_secret <> 0 then
    raise exception 'unbind left a verified secret';
  end if;
  if exists (
    select 1
    from public.line_customer_bindings
    where organization_id = 'org-the-enjoye'
      and customer_id = 'cust-1'
      and verified is true
      and status = 'active'
  ) then
    raise exception 'unbind left an active verified binding';
  end if;
  if public.line_automation_schedule_recipient_ready('org-the-enjoye', 'cust-1')
     or public.line_automation_send_recipient_allowed('org-the-enjoye', 'cust-1') then
    raise exception 'unbind still allowed send';
  end if;
  select status, recipient_ready into v_status, v_ready
  from public.line_automation_jobs
  where fingerprint = 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning';
  if v_ready is not false or v_status is distinct from 'pending_recipient' then
    raise exception 'unbind left a scheduled trusted job: % %', v_status, v_ready;
  end if;
  update public.line_automation_jobs
  set status = 'scheduled'
  where fingerprint = 'org-the-enjoye|birthday_greeting|cust-1|birthday_morning';
  if public.line_automation_send_recipient_allowed('org-the-enjoye', 'cust-1') then
    raise exception 'unbind still allowed send';
  end if;

  v_started := public.start_line_customer_bind_challenge(
    'org-the-enjoye', 'cust-1', true, v_hmac_key
  );
  v_code := v_started->>'code';
  insert into public.line_webhook_events (organization_id, event_id, bound)
  values ('org-the-enjoye', 'evt-after-unbind', false);
  v_issued := now();
  v_proof := tests.line_customer_bind_proof(
    'org-the-enjoye', 'token-local', 'evt-after-unbind', v_code,
    v_hash, 'v1.cipher-cust-1-again', '••••aaaa', 'line-cred-v1',
    v_hmac_key, v_issued
  );
  v_consumed := public.consume_line_customer_bind_challenge_public(
    'org-the-enjoye',
    'token-local',
    v_code,
    'evt-after-unbind',
    v_proof,
    v_issued,
    'v1.cipher-cust-1-again',
    '••••aaaa',
    v_hash,
    'line-cred-v1'
  );
  if (v_consumed->>'captured')::boolean is not true then
    raise exception 'bind after unbind failed: %', v_consumed;
  end if;
  if exists (
    select 1
    from public.line_customer_bindings
    where organization_id = 'org-the-enjoye'
      and customer_id = 'cust-1'
      and (verified is true or status is distinct from 'pending' or confirmed_at is not null)
  ) then
    raise exception 'bind after unbind skipped pending confirmation';
  end if;
  if exists (select 1 from public.line_customer_binding_rebinds) then
    raise exception 'bind after unbind created a staged rebind';
  end if;
  perform public.confirm_line_customer_binding('org-the-enjoye', 'cust-1');
  select count(*) into v_count
  from public.line_customer_bindings
  where organization_id = 'org-the-enjoye' and customer_id = 'cust-1';
  if v_count <> 1 then
    raise exception 'rebind created a second binding row: %', v_count;
  end if;

  v_other := public.read_line_customer_bindings('org-the-enjoye');
  if v_other->>'organization_id' is distinct from 'org-the-enjoye' then
    raise exception 'read bindings leaked another organization';
  end if;
  if v_other::text like '%v1.cipher%' or v_other::text like '%Ubbbbbbbb%' or v_other::text like '%' || v_hmac_key || '%' then
    raise exception 'read bindings exposed ciphertext, plaintext user id, or server key';
  end if;
end;
$$;
