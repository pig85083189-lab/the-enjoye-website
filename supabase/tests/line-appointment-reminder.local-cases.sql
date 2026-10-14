-- Local-only cases. Unix socket. Never Preview / Production / LINE.

set session authorization postgres;
select tests.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

do $$
declare
  v_rule jsonb;
  v_ws jsonb;
  v_bind jsonb;
  v_claim jsonb;
  v_claim2 jsonb;
  v_dry jsonb;
  v_hash text := encode(sha256(convert_to('org-the-enjoye:U0123456789abcdef0123456789abcdef', 'utf8')), 'hex');
  v_other_hash text := encode(sha256(convert_to('org-lumiere:U0123456789abcdef0123456789abcdef', 'utf8')), 'hex');
  v_code text;
  v_job_id text := 'laj-local000000001';
  v_req text := 'larq-local000000001';
  v_count integer;
begin
  perform tests.assert(v_hash <> v_other_hash, 'hash is org-scoped');
  perform tests.assert(length(v_hash) = 64, 'hash length');

  v_rule := public.upsert_line_appointment_reminder_rule(
    'org-the-enjoye', true, array['hours_before_3']::text[], '提醒文字', 'staff-enjoye'
  );
  perform tests.assert(v_rule->>'ok' = 'true', 'owner can save rule');

  begin
    perform tests.become('cccccccc-cccc-cccc-cccc-cccccccccccc');
    perform public.upsert_line_appointment_reminder_rule(
      'org-the-enjoye', true, array['hours_before_3']::text[], 'x', 'staff-enjoye-2'
    );
    perform tests.assert(false, 'staff must not upsert reminder rule');
  exception when insufficient_privilege then
    null;
  end;
  perform tests.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

  begin
    perform tests.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    perform public.read_line_appointment_reminder_workspace('org-the-enjoye');
    perform tests.assert(false, 'cross-org workspace read must fail');
  exception when insufficient_privilege then
    null;
  end;
  perform tests.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

  v_ws := public.read_line_appointment_reminder_workspace('org-the-enjoye');
  perform tests.assert(v_ws->>'saved' = 'true', 'workspace saved');

  perform public.insert_line_appointment_reminder_jobs(
    'org-the-enjoye',
    jsonb_build_array(jsonb_build_object(
      'id', v_job_id,
      'organizationId', 'org-the-enjoye',
      'appointmentId', 'apt-future',
      'customerId', 'cust-1',
      'serviceId', 'svc-1',
      'timingId', 'hours_before_3',
      'fingerprint', 'apt-future|hours_before_3|x|cust-1|svc-1',
      'scheduledFor', now() - interval '1 minute',
      'requestId', v_req
    ))
  );

  begin
    insert into public.line_automation_deliveries (
      id, organization_id, job_id, request_id, status, message
    ) values (
      'lad-crossorg0000001', 'org-lumiere', v_job_id, 'larq-crossorg0000001', 'skipped', 'x'
    );
    perform tests.assert(false, 'delivery must not attach to another org job');
  exception when foreign_key_violation then
    null;
  end;

  begin
    insert into public.line_customer_bindings (
      organization_id, customer_app_id, line_user_id_cipher, line_user_id_hash,
      line_user_id_hint, key_id, verified, bind_method, bound_at
    ) values (
      'org-the-enjoye', 'cust-hint-1', 'v1.cipher-a',
      encode(sha256(convert_to('org-the-enjoye:Uffffffffffffffffffffffffffffffff', 'utf8')), 'hex'),
      '••••abcd', 'k1', true, 'webhook_code', now()
    );
    insert into public.line_customer_bindings (
      organization_id, customer_app_id, line_user_id_cipher, line_user_id_hash,
      line_user_id_hint, key_id, verified, bind_method, bound_at
    ) values (
      'org-the-enjoye', 'cust-hint-2', 'v1.cipher-b',
      encode(sha256(convert_to('org-the-enjoye:Uffffffffffffffffffffffffffffffff', 'utf8')), 'hex'),
      '••••zzzz', 'k1', true, 'webhook_code', now()
    );
    perform tests.assert(false, 'same hash cannot bind two customers');
  exception when unique_violation then
    null;
  end;

  v_bind := public.start_line_customer_bind_challenge('org-the-enjoye', 'cust-1');
  v_code := v_bind->>'code';
  perform tests.assert(v_code ~ '^[0-9A-F]{8}$', 'challenge code');

  set session authorization service_role;
  v_bind := public.consume_line_customer_bind_challenge(
    'org-the-enjoye', v_code, 'v1.cipher-user', v_hash, '••••cdef', 'k1'
  );
  perform tests.assert(v_bind->>'bound' = 'true', 'consume bind');
  perform tests.assert(v_bind->>'consented' = 'false', 'bind does not opt in');
  set session authorization postgres;

  update public.line_automation_jobs
  set status = 'claimed', claimed_at = now() - interval '40 seconds', send_claimed_at = now() - interval '40 seconds'
  where request_id = v_req;
  set session authorization service_role;
  perform tests.assert(public.finalize_stale_line_appointment_reminder_claimed(30) >= 1, 'stale finalize');
  set session authorization postgres;
  perform tests.assert(
    (select status from public.line_automation_jobs where request_id = v_req) = 'pending_confirmation',
    'stale claimed becomes pending_confirmation'
  );

  insert into public.line_automation_jobs (
    id, organization_id, appointment_app_id, customer_app_id, service_app_id,
    timing_id, fingerprint, scheduled_for, status, request_id
  ) values (
    'laj-local000000002', 'org-the-enjoye', 'apt-future', 'cust-1', 'svc-1',
    'day_before_morning', 'fp-2', now() - interval '1 minute', 'scheduled', 'larq-local000000002'
  );

  set session authorization service_role;
  v_claim := public.claim_line_appointment_reminder_job(
    'org-the-enjoye', 'larq-local000000002', true, 20, now()
  );
  set session authorization postgres;
  perform tests.assert(v_claim->>'ok' = 'true', 'first claim');

  insert into public.line_automation_jobs (
    id, organization_id, appointment_app_id, customer_app_id, service_app_id,
    timing_id, fingerprint, scheduled_for, status, request_id
  ) values (
    'laj-local000000003', 'org-lumiere', 'apt-other', 'cust-9', 'svc-9',
    'hours_before_3', 'fp-3', now() - interval '1 minute', 'scheduled', 'larq-local000000003'
  );
  set session authorization service_role;
  v_claim2 := public.claim_line_appointment_reminder_job(
    'org-lumiere', 'larq-local000000003', true, 20, now()
  );
  set session authorization postgres;
  perform tests.assert(v_claim2->>'ok' = 'false', 'shared channel blocks second claim');
  perform tests.assert(v_claim2->>'reason' = 'pending_confirmation', 'inflight reason');

  update public.line_automation_jobs
  set status = 'pending_confirmation', claimed_at = now() - interval '2 minutes'
  where request_id = 'larq-local000000002';

  insert into public.line_automation_jobs (
    id, organization_id, appointment_app_id, customer_app_id, service_app_id,
    timing_id, fingerprint, scheduled_for, status, request_id
  ) values (
    'laj-local000000004', 'org-the-enjoye', 'apt-future', 'cust-1', 'svc-1',
    'hours_before_3', 'fp-4', now() - interval '1 minute', 'scheduled', 'larq-local000000004'
  );
  set session authorization service_role;
  v_claim2 := public.claim_line_appointment_reminder_job(
    'org-the-enjoye', 'larq-local000000004', true, 20, now()
  );
  perform tests.assert(v_claim2->>'ok' = 'true', 'pending_confirmation does not hold channel');

  v_claim2 := public.claim_line_appointment_reminder_job(
    'org-the-enjoye', 'larq-local000000001', true, 20, now()
  );
  perform tests.assert(v_claim2->>'ok' = 'false', 'pending_confirmation is not retried');

  reset session authorization;
  perform tests.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  set session authorization authenticated;
  v_dry := public.run_line_appointment_reminder_dry_run('org-the-enjoye');
  reset session authorization;
  set session authorization postgres;
  perform tests.assert(v_dry->>'sent' = 'false', 'dry-run never sent');
  perform tests.assert(
    (select send_claimed_at is null from public.line_automation_jobs where request_id = 'larq-local000000003'),
    'dry-run does not consume send claims'
  );

  perform tests.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  perform public.reconcile_line_appointment_reminder_job('org-the-enjoye', 'larq-local000000001', 'failed');
  perform tests.assert(
    (select status from public.line_automation_jobs where request_id = 'larq-local000000001') = 'failed',
    'owner reconcile without resend'
  );

  set session authorization service_role;
  perform public.mark_line_customer_unsubscribed('org-the-enjoye', v_hash);
  perform public.unbind_line_customer_by_hash('org-the-enjoye', v_hash);
  set session authorization postgres;
  perform tests.assert(
    (select appointment_reminder_opt_in from public.line_notification_preferences
      where organization_id = 'org-the-enjoye' and customer_app_id = 'cust-1') = false,
    'unsubscribe clears consent'
  );
  perform tests.assert(
    (select unbound_at is not null from public.line_customer_bindings
      where organization_id = 'org-the-enjoye' and customer_app_id = 'cust-1'),
    'unbind by hash'
  );

  set session authorization authenticated;
  begin
    perform public.claim_line_appointment_reminder_job(
      'org-the-enjoye', 'larq-local000000004', true, 20, now()
    );
    -- function returns jsonb unauthorized rather than throw
  exception when others then
    null;
  end;
end $$;

set session authorization postgres;
select tests.assert(
  (select relrowsecurity from pg_class where relname = 'line_automation_jobs'),
  'jobs rls on'
);
select tests.assert(
  not has_function_privilege('authenticated', 'public.claim_line_appointment_reminder_job(text,text,boolean,integer,timestamptz)', 'execute'),
  'authenticated cannot claim'
);
select tests.assert(
  not has_function_privilege('anon', 'public.consume_line_customer_bind_challenge(text,text,text,text,text,text)', 'execute'),
  'anon cannot consume customer bind'
);
select tests.assert(
  has_function_privilege('authenticated', 'public.upsert_line_appointment_reminder_rule(text,boolean,text[],text,text)', 'execute'),
  'authenticated can execute owner rule rpc'
);

select 'line-appointment-reminder local cases passed' as result;
