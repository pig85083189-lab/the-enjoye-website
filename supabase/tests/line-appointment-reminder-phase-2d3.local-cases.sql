-- Phase 2D-3 local-only cases. Unix socket. Never Preview / Production / LINE.
-- Verifies GRANT / effective EXECUTE. authenticator is not an identity.

set session authorization postgres;
select tests.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

update public.line_automation_jobs
set status = 'canceled', updated_at = now()
where status in ('scheduled', 'claimed', 'pending_confirmation')
  and appointment_app_id in ('apt-2d3-due', 'apt-2d3-peer');

insert into public.line_automation_jobs (
  id, organization_id, appointment_app_id, customer_app_id, service_app_id,
  timing_id, fingerprint, scheduled_for, status, request_id
) values
  (
    'laj-2d3due000000001', 'org-the-enjoye', 'apt-2d3-due', 'cust-1', 'svc-1',
    'hours_before_3', 'fp-2d3-due', now() - interval '1 minute', 'scheduled',
    'larq-2d3due000000001'
  ),
  (
    'laj-2d3peer00000001', 'org-lumiere', 'apt-2d3-peer', 'cust-9', 'svc-9',
    'hours_before_3', 'fp-2d3-peer', now() - interval '1 minute', 'scheduled',
    'larq-2d3peer00000001'
  )
on conflict (id) do nothing;

do $$
declare
  v_json jsonb;
  v_before integer;
  v_after integer;
  v_deliveries integer;
begin
  select count(*) into v_before from public.line_automation_deliveries;
  select count(*) into v_deliveries
  from public.line_automation_deliveries
  where request_id like 'larq-2d3%';
  perform tests.assert(v_deliveries = 0, '2d3 fixtures start with no deliveries');

  set session authorization service_role;
  v_json := public.run_line_appointment_reminder_cron_dry_run();
  perform tests.assert(v_json->>'ok' = 'true', 'service_role cron dry-run');
  perform tests.assert(v_json->>'sent' = 'false', 'cron dry-run sent=false');
  perform tests.assert((v_json->>'eligible') = 'false', 'cron dry-run eligible=false');
  reset session authorization;

  perform tests.assert(
    exists (
      select 1 from public.line_automation_dry_runs
      where job_id = 'laj-2d3due000000001' and eligible is not true
    ),
    'cron dry-run wrote enjoye check row'
  );
  perform tests.assert(
    (select status from public.line_automation_jobs where id = 'laj-2d3due000000001') = 'scheduled',
    'cron dry-run does not claim'
  );
  perform tests.assert(
    (select send_claimed_at is null from public.line_automation_jobs where id = 'laj-2d3due000000001'),
    'cron dry-run does not consume send claim'
  );
  select count(*) into v_after from public.line_automation_deliveries;
  perform tests.assert(v_after = v_before, 'cron dry-run creates no deliveries');

  set session authorization authenticator;
  set role service_role;
  perform tests.assert(
    public.finalize_stale_line_appointment_reminder_claimed(30) >= 0,
    'postgrest service_role can finalize'
  );
  v_json := public.run_line_appointment_reminder_cron_dry_run();
  perform tests.assert(v_json->>'ok' = 'true', 'postgrest service_role cron');
  perform tests.assert(v_json->>'sent' = 'false', 'postgrest cron sent=false');
  reset role;
  reset session authorization;

  begin
    set session authorization authenticator;
    perform public.run_line_appointment_reminder_cron_dry_run();
    perform tests.assert(false, 'authenticator without SET ROLE must fail');
  exception when insufficient_privilege then
    null;
  end;
  reset session authorization;

  begin
    set session authorization anon;
    perform public.finalize_stale_line_appointment_reminder_claimed(30);
    perform tests.assert(false, 'anon cannot finalize');
  exception when insufficient_privilege then
    null;
  end;
  reset session authorization;

  begin
    set session authorization anon;
    perform public.run_line_appointment_reminder_cron_dry_run();
    perform tests.assert(false, 'anon cannot cron dry-run');
  exception when insufficient_privilege then
    null;
  end;
  reset session authorization;

  begin
    set session authorization authenticated;
    perform public.run_line_appointment_reminder_cron_dry_run();
    perform tests.assert(false, 'authenticated cannot cron dry-run');
  exception when insufficient_privilege then
    null;
  end;
  reset session authorization;

  begin
    set session authorization authenticated;
    perform public.finalize_stale_line_appointment_reminder_claimed(30);
    perform tests.assert(false, 'authenticated cannot finalize');
  exception when insufficient_privilege then
    null;
  end;
  reset session authorization;

  begin
    set session authorization authenticated;
    perform public.claim_line_appointment_reminder_job(
      'org-the-enjoye', 'larq-2d3due000000001', true, 20, now()
    );
    perform tests.assert(false, 'authenticated cannot claim');
  exception when insufficient_privilege then
    null;
  end;
  reset session authorization;

  begin
    set session authorization authenticated;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform public.run_line_appointment_reminder_cron_dry_run();
    perform tests.assert(false, 'forged JWT role cannot cron dry-run');
  exception when insufficient_privilege then
    null;
  end;
  reset session authorization;

  begin
    set session authorization authenticator;
    set role authenticated;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform public.finalize_stale_line_appointment_reminder_claimed(30);
    perform tests.assert(false, 'authenticator SET ROLE authenticated cannot finalize');
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  reset session authorization;

  begin
    set session authorization authenticator;
    set role authenticated;
    perform public.run_line_appointment_reminder_cron_dry_run();
    perform tests.assert(false, 'authenticator SET ROLE authenticated cannot cron');
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  reset session authorization;

  begin
    set session authorization authenticator;
    set role anon;
    perform public.run_line_appointment_reminder_cron_dry_run();
    perform tests.assert(false, 'authenticator SET ROLE anon cannot cron');
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  reset session authorization;

  perform tests.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  set session authorization authenticated;
  v_json := public.run_line_appointment_reminder_dry_run('org-the-enjoye');
  perform tests.assert(v_json->>'sent' = 'false', 'owner org dry-run stays closed');
  begin
    perform public.run_line_appointment_reminder_dry_run('org-lumiere');
    perform tests.assert(false, 'enjoye owner cannot dry-run lumiere');
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.run_line_appointment_reminder_dry_run(null);
    perform tests.assert(false, 'authenticated cannot global dry-run');
  exception when insufficient_privilege then
    null;
  end;
  reset session authorization;

  grant execute on function public.finalize_stale_line_appointment_reminder_claimed(integer)
    to authenticated;
  begin
    set session authorization authenticated;
    perform public.finalize_stale_line_appointment_reminder_claimed(30);
    perform tests.assert(false, 'leaked EXECUTE still denied by helper');
  exception when insufficient_privilege then
    null;
  end;
  reset session authorization;
  revoke execute on function public.finalize_stale_line_appointment_reminder_claimed(integer)
    from authenticated;

  grant execute on function public.run_line_appointment_reminder_cron_dry_run() to public;
  begin
    set session authorization authenticated;
    perform public.run_line_appointment_reminder_cron_dry_run();
    perform tests.assert(false, 'PUBLIC EXECUTE still denied by helper');
  exception when insufficient_privilege then
    null;
  end;
  reset session authorization;
  revoke execute on function public.run_line_appointment_reminder_cron_dry_run() from public;
  grant execute on function public.run_line_appointment_reminder_cron_dry_run() to service_role;

  set session authorization authenticator;
  set role service_role;
  v_json := public.run_line_appointment_reminder_cron_dry_run();
  perform tests.assert(v_json->>'ok' = 'true', 'service_role cron still works after revoke PUBLIC');
  perform tests.assert(v_json->>'sent' = 'false', 'repaired cron sent=false');
  reset role;
  reset session authorization;
end $$;

set session authorization postgres;

create or replace function tests.public_has_execute(p_sig text)
returns boolean
language sql
stable
as $$
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
  from pg_catalog.pg_proc p
  where p.oid = p_sig::regprocedure;
$$;

select tests.assert(
  not has_function_privilege('anon', 'public.run_line_appointment_reminder_cron_dry_run()', 'execute'),
  'anon cannot execute cron dry-run'
);
select tests.assert(
  not has_function_privilege(
    'authenticated',
    'public.run_line_appointment_reminder_cron_dry_run()',
    'execute'
  ),
  'authenticated cannot execute cron dry-run'
);
select tests.assert(
  has_function_privilege('service_role', 'public.run_line_appointment_reminder_cron_dry_run()', 'execute'),
  'service_role can execute cron dry-run'
);
select tests.assert(
  not has_function_privilege(
    'anon',
    'public.finalize_stale_line_appointment_reminder_claimed(integer)',
    'execute'
  ),
  'anon cannot execute finalize'
);
select tests.assert(
  not has_function_privilege(
    'authenticated',
    'public.finalize_stale_line_appointment_reminder_claimed(integer)',
    'execute'
  ),
  'authenticated cannot execute finalize'
);
select tests.assert(
  not has_function_privilege(
    'anon',
    'public.line_appointment_reminder_dry_run_internal(text)',
    'execute'
  ),
  'anon cannot execute internal dry-run'
);
select tests.assert(
  not has_function_privilege(
    'authenticated',
    'public.line_appointment_reminder_dry_run_internal(text)',
    'execute'
  ),
  'authenticated cannot execute internal dry-run'
);
select tests.assert(
  not has_function_privilege(
    'service_role',
    'public.line_appointment_reminder_dry_run_internal(text)',
    'execute'
  ),
  'service_role cannot call internal dry-run directly'
);
select tests.assert(
  not has_function_privilege(
    'authenticated',
    'public.line_appointment_reminder_service_role_call_allowed(text)',
    'execute'
  ),
  'authenticated cannot execute privilege helper'
);
select tests.assert(
  pg_get_functiondef(
    'public.claim_line_appointment_reminder_job(text,text,boolean,integer,timestamptz)'::regprocedure
  ) like '%870121%',
  'channel lock 870121 unchanged'
);
select tests.assert(
  pg_get_functiondef(
    'public.line_appointment_reminder_service_role_call_allowed(text)'::regprocedure
  ) not like '%current_setting(%request.jwt%',
  'helper does not read JWT claims'
);
select tests.assert(
  pg_get_functiondef(
    'public.line_appointment_reminder_service_role_call_allowed(text)'::regprocedure
  ) not like '%session_user = ''authenticator''%',
  'helper does not treat authenticator as service_role'
);
select tests.assert(
  pg_get_functiondef(
    'public.run_line_appointment_reminder_dry_run(text)'::regprocedure
  ) not like '%finalize_stale_line_appointment_reminder_claimed%',
  'owner dry-run does not call privileged finalize'
);
select tests.assert(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and pg_get_functiondef(p.oid) ~ 'finalize_stale_line_appointment_reminder_claimed|run_line_appointment_reminder_cron_dry_run|claim_line_appointment_reminder_job|complete_line_appointment_reminder_job|consume_line_customer_bind_challenge|set_line_appointment_reminder_consent|mark_line_customer_unsubscribed|mark_line_customer_blocked|unbind_line_customer_by_hash|line_appointment_reminder_service_role_call_allowed'
  ),
  'authenticated functions do not call privileged service RPCs'
);
select tests.assert(
  not tests.public_has_execute('public.run_line_appointment_reminder_cron_dry_run()'),
  'PUBLIC cannot execute cron dry-run'
);
select tests.assert(
  not tests.public_has_execute('public.finalize_stale_line_appointment_reminder_claimed(integer)'),
  'PUBLIC cannot execute finalize'
);
select tests.assert(
  not tests.public_has_execute('public.line_appointment_reminder_dry_run_internal(text)'),
  'PUBLIC cannot execute internal dry-run'
);
select tests.assert(
  not has_function_privilege(
    'authenticator',
    'public.run_line_appointment_reminder_cron_dry_run()',
    'execute'
  ),
  'authenticator cannot execute cron dry-run'
);
select tests.assert(
  not has_function_privilege(
    'authenticator',
    'public.finalize_stale_line_appointment_reminder_claimed(integer)',
    'execute'
  ),
  'authenticator cannot execute finalize'
);
select tests.assert(
  not has_function_privilege(
    'service_role',
    'public.line_appointment_reminder_service_role_call_allowed(text)',
    'execute'
  ),
  'service_role cannot execute privilege helper directly'
);
select tests.assert(
  has_function_privilege(
    'authenticated',
    'public.run_line_appointment_reminder_dry_run(text)',
    'execute'
  ),
  'authenticated keeps owner org dry-run'
);
select tests.assert(
  not exists (
    select 1 from public.line_automation_deliveries where request_id like 'larq-2d3%'
  ),
  '2d3 dry-run created no deliveries'
);

select 'line-appointment-reminder phase 2d3 local cases passed' as result;
