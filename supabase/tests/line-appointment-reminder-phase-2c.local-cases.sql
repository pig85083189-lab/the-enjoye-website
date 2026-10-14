-- Phase 2C local-only cases. Unix socket. Never Preview / Production / LINE.

set session authorization postgres;
select tests.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

do $$
declare
  v_start jsonb;
  v_consume jsonb;
  v_consent jsonb;
  v_ws jsonb;
  v_code text;
  v_hash text := encode(sha256(convert_to('org-the-enjoye:Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'utf8')), 'hex');
  v_i integer;
begin
  v_start := public.start_line_customer_bind_challenge('org-the-enjoye', 'cust-2c-rate');
  perform tests.assert(v_start->>'ok' = 'true', 'first bind start ok');
  perform tests.assert(v_start->>'consent' = 'bind_does_not_opt_in', 'start does not opt in');
  v_start := public.start_line_customer_bind_challenge('org-the-enjoye', 'cust-2c-rate');
  perform tests.assert(v_start->>'ok' = 'false', '60s rate limit');
  perform tests.assert(v_start->>'reason' = 'rate_limited', 'rate_limited reason');

  insert into public.line_customer_bind_challenges (
    id, organization_id, customer_app_id, code_hash, expires_at, created_at
  ) values
    ('lcc-burst000000001', 'org-the-enjoye', 'cust-2c-burst',
      encode(sha256(convert_to('org-the-enjoye:AAAAAAAA', 'utf8')), 'hex'),
      now() + interval '10 minutes', now() - interval '3 minutes'),
    ('lcc-burst000000002', 'org-the-enjoye', 'cust-2c-burst',
      encode(sha256(convert_to('org-the-enjoye:BBBBBBBB', 'utf8')), 'hex'),
      now() + interval '10 minutes', now() - interval '2 minutes'),
    ('lcc-burst000000003', 'org-the-enjoye', 'cust-2c-burst',
      encode(sha256(convert_to('org-the-enjoye:CCCCCCCC', 'utf8')), 'hex'),
      now() + interval '10 minutes', now() - interval '90 seconds');
  v_start := public.start_line_customer_bind_challenge('org-the-enjoye', 'cust-2c-burst');
  perform tests.assert(v_start->>'reason' = 'attempt_limited', '3 per 15 minutes locks');

  v_start := public.start_line_customer_bind_challenge('org-the-enjoye', 'cust-2c-lock');
  v_code := v_start->>'code';
  perform tests.assert(v_code ~ '^[0-9A-F]{8}$', 'lock challenge code');
  set session authorization service_role;
  for v_i in 1..4 loop
    v_consume := public.consume_line_customer_bind_challenge(
      'org-the-enjoye', '00000000', 'v1.cipher-lock', v_hash, '••••lock', 'k1'
    );
    perform tests.assert(v_consume->>'bound' = 'false', 'wrong code rejected');
  end loop;
  v_consume := public.consume_line_customer_bind_challenge(
    'org-the-enjoye', '00000000', 'v1.cipher-lock', v_hash, '••••lock', 'k1'
  );
  perform tests.assert(v_consume->>'reason' = 'attempt_limited', '5 failures lock');
  v_consume := public.consume_line_customer_bind_challenge(
    'org-the-enjoye', v_code, 'v1.cipher-lock', v_hash, '••••lock', 'k1'
  );
  perform tests.assert(v_consume->>'bound' = 'false', 'locked challenge cannot bind');
  set session authorization postgres;

  v_start := public.start_line_customer_bind_challenge('org-the-enjoye', 'cust-2c-consent');
  v_code := v_start->>'code';
  set session authorization service_role;
  v_consume := public.consume_line_customer_bind_challenge(
    'org-the-enjoye', v_code, 'v1.cipher-consent', v_hash, '••••sent', 'k1'
  );
  perform tests.assert(v_consume->>'bound' = 'true', 'bind succeeds');
  perform tests.assert(v_consume->>'consented' = 'false', 'bind stays opted out');
  v_consent := public.set_line_appointment_reminder_consent(
    'org-the-enjoye', v_hash, true
  );
  perform tests.assert(v_consent->>'ok' = 'true', 'consent rpc');
  perform tests.assert(v_consent->>'opt_in' = 'true', 'opt in true');
  set session authorization postgres;
  perform tests.assert(
    (select appointment_reminder_opt_in from public.line_notification_preferences
      where organization_id = 'org-the-enjoye' and customer_app_id = 'cust-2c-consent') = true,
    'consent row opted in'
  );

  v_ws := public.read_line_appointment_reminder_workspace('org-the-enjoye');
  perform tests.assert((v_ws->>'bind_count')::int >= 1, 'bind count after bind');
  perform tests.assert((v_ws->>'consent_count')::int >= 1, 'consent count after opt-in');

  set session authorization service_role;
  v_consent := public.set_line_appointment_reminder_consent(
    'org-the-enjoye', v_hash, false
  );
  perform tests.assert(v_consent->>'opt_in' = 'false', 'consent off');
  set session authorization postgres;
  v_ws := public.read_line_appointment_reminder_workspace('org-the-enjoye');
  perform tests.assert((v_ws->>'consent_count')::int = 0, 'unsubscribe removes consent count');

  begin
    set session authorization authenticated;
    perform public.set_line_appointment_reminder_consent(
      'org-the-enjoye', v_hash, true
    );
    perform tests.assert(false, 'authenticated must not set consent');
  exception when insufficient_privilege then
    null;
  end;
  set session authorization postgres;
end $$;

select tests.assert(
  not has_function_privilege(
    'authenticated',
    'public.set_line_appointment_reminder_consent(text,text,boolean)',
    'execute'
  ),
  'authenticated cannot execute consent rpc'
);
select tests.assert(
  not has_function_privilege(
    'anon',
    'public.set_line_appointment_reminder_consent(text,text,boolean)',
    'execute'
  ),
  'anon cannot execute consent rpc'
);

select 'line-appointment-reminder phase 2c local cases passed' as result;
