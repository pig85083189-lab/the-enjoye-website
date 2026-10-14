-- Local-only Phase 2E-9 privilege and environment cases.
-- Never connect to Preview or Production. Never call LINE.

do $$
declare
  v_owner uuid := '11111111-1111-1111-1111-111111111111';
  v_other uuid := '22222222-2222-2222-2222-222222222222';
  v_grant jsonb;
  v_arm jsonb;
  v_claim jsonb;
  v_denied boolean;
begin
  insert into public.staff_auth_memberships
    (id, user_id, auth_user_id, organization_id, role, display_name, is_active)
  values
    ('mem-test-owner', 'staff-001', v_owner, 'org-beauty-os-test', 'OWNER', 'TEST Owner', true),
    ('mem-other-owner', 'staff-002', v_other, 'org-beauty-os-test', 'OWNER', 'Other Owner', true);

  insert into public.line_official_accounts (organization_id, channel_id)
  values
    ('org-beauty-os-test', '2009219238'),
    ('org-the-enjoye', '2009219238');

  insert into public.line_owner_recipients
    (organization_id, staff_user_id, line_user_id_hint, bind_method, bound_at)
  values
    ('org-beauty-os-test', 'staff-001', '••••fc8c', 'webhook_code', '2026-10-10T07:44:49.960272+00:00');

  insert into public.line_owner_recipient_secrets (organization_id, key_id)
  values ('org-beauty-os-test', 'line-cred-v1');

  perform tests.become(v_owner);
  v_grant := public.grant_line_owner_self_reminder_test('org-beauty-os-test', true);
  perform tests.assert(v_grant->>'ok' = 'false', 'unarmed preview must fail closed');
  perform tests.assert(v_grant->>'reason' = 'send_closed', 'unarmed preview reason');

  perform set_config('app.beauty_os_runtime', 'preview', true);
  v_grant := public.grant_line_owner_self_reminder_test('org-beauty-os-test', true);
  perform tests.assert(v_grant->>'ok' = 'false', 'client GUC preview is not enough');

  v_arm := public.arm_line_owner_self_reminder_preview_runtime(
    'knccefcxncglgpmvgqlp.supabase.co',
    'preview'
  );
  perform tests.assert(v_arm->>'ok' = 'false', 'production host cannot arm');

  v_arm := public.arm_line_owner_self_reminder_preview_runtime(
    'bfzquejrtgqzzarhkiya.supabase.co',
    'preview'
  );
  perform tests.assert(v_arm->>'ok' = 'true', 'preview host can arm as definer after GRANT lock');

  v_grant := public.grant_line_owner_self_reminder_test('org-beauty-os-test', true);
  perform tests.assert(v_grant->>'ok' = 'true', 'armed owner can grant');

  perform tests.become(v_other);
  v_grant := public.revoke_line_owner_self_reminder_test(
    'org-beauty-os-test',
    (select id from public.line_owner_self_reminder_grants limit 1)
  );
  perform tests.assert(v_grant->>'reason' = 'unauthorized', 'non-self revoke refused');

  perform tests.become(v_owner);
  perform set_config('app.beauty_os_runtime', 'production', true);
  v_grant := public.grant_line_owner_self_reminder_test('org-beauty-os-test', true);
  perform tests.assert(v_grant->>'reason' = 'send_closed', 'production GUC refuses even when armed');
  perform set_config('app.beauty_os_runtime', '', true);

  perform tests.assert(
    has_function_privilege(
      'authenticated',
      'public.grant_line_owner_self_reminder_test(text,boolean)',
      'execute'
    ),
    'authenticated may grant'
  );
  perform tests.assert(
    has_function_privilege(
      'authenticated',
      'public.revoke_line_owner_self_reminder_test(text,text)',
      'execute'
    ),
    'authenticated may revoke'
  );
  perform tests.assert(
    has_function_privilege(
      'authenticated',
      'public.issue_line_owner_self_reminder_oneshot(text,text)',
      'execute'
    ),
    'authenticated may issue'
  );
  perform tests.assert(
    not has_function_privilege(
      'authenticated',
      'public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text,text)',
      'execute'
    ),
    'authenticated cannot claim'
  );
  perform tests.assert(
    not has_function_privilege(
      'authenticated',
      'public.record_line_owner_self_reminder_quota_snapshot(text,boolean,text,integer,timestamptz)',
      'execute'
    ),
    'authenticated cannot record quota'
  );
  perform tests.assert(
    not has_function_privilege(
      'authenticated',
      'public.arm_line_owner_self_reminder_preview_runtime(text,text)',
      'execute'
    ),
    'authenticated cannot arm runtime'
  );
  perform tests.assert(
    not has_function_privilege(
      'anon',
      'public.grant_line_owner_self_reminder_test(text,boolean)',
      'execute'
    ),
    'anon cannot grant'
  );
  perform tests.assert(
    has_function_privilege(
      'service_role',
      'public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text,text)',
      'execute'
    ),
    'service_role may claim'
  );
  perform tests.assert(
    not has_function_privilege(
      'service_role',
      'public.grant_line_owner_self_reminder_test(text,boolean)',
      'execute'
    ),
    'service_role cannot grant'
  );

  v_denied := false;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_claim := public.claim_line_owner_self_reminder_oneshot(
      'org-beauty-os-test',
      'laros-local00000001',
      'lorg-local00000001',
      'apt-2e7-owner-self',
      '確認發送一則給我自己的預約提醒測試',
      'staff-001'
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;
  execute 'reset role';
  perform tests.assert(v_denied, 'authenticated SET ROLE cannot execute claim');

  perform tests.assert(
    not has_function_privilege(
      'anon',
      'public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text,text)',
      'execute'
    ),
    'anon cannot claim'
  );
  perform tests.assert(
    not has_function_privilege(
      'anon',
      'public.record_line_owner_self_reminder_quota_snapshot(text,boolean,text,integer,timestamptz)',
      'execute'
    ),
    'anon cannot record quota'
  );
  perform tests.assert(
    has_function_privilege(
      'service_role',
      'public.record_line_owner_self_reminder_quota_snapshot(text,boolean,text,integer,timestamptz)',
      'execute'
    ),
    'service_role may record quota'
  );
  perform tests.assert(
    has_function_privilege(
      'service_role',
      'public.arm_line_owner_self_reminder_preview_runtime(text,text)',
      'execute'
    ),
    'service_role may arm runtime'
  );

  v_denied := false;
  begin
    execute 'set local role authenticated';
    v_arm := public.arm_line_owner_self_reminder_preview_runtime(
      'bfzquejrtgqzzarhkiya.supabase.co',
      'preview'
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;
  execute 'reset role';
  perform tests.assert(v_denied, 'authenticated cannot arm runtime');

  v_denied := false;
  begin
    execute 'set local role authenticated';
    perform public.record_line_owner_self_reminder_quota_snapshot(
      '2009219238',
      true,
      'none',
      null,
      now()
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;
  execute 'reset role';
  perform tests.assert(v_denied, 'authenticated cannot record quota by calling it');

  revoke execute on function public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text,text)
    from service_role;
  perform tests.assert(
    public.line_owner_self_reminder_service_role_call_allowed(
      'public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text,text)'
    ) is not true,
    'missing GRANT fails closed'
  );
  grant execute on function public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text,text)
    to service_role;
  perform tests.assert(
    public.line_owner_self_reminder_service_role_call_allowed(
      'public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text,text)'
    ),
    'restored GRANT allows service_role claim lock'
  );

  perform tests.become(v_owner);
  v_grant := public.issue_line_owner_self_reminder_oneshot(
    'org-beauty-os-test',
    (select id from public.line_owner_self_reminder_grants where revoked_at is null limit 1)
  );
  perform tests.assert(v_grant->>'ok' = 'true', 'armed owner can issue oneshot');

  v_grant := public.revoke_line_owner_self_reminder_test(
    'org-beauty-os-test',
    (select id from public.line_owner_self_reminder_grants where revoked_at is null limit 1)
  );
  perform tests.assert(v_grant->>'ok' = 'true', 'armed owner can revoke self grant');
end;
$$;
