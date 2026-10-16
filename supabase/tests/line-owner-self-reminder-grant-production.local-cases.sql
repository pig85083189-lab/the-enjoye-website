-- Local-only Phase 2F-1 Production Owner-self grant review.
-- Never connect to Preview or Production. Never call LINE.

do $$
declare
  v_enjoye_owner uuid := '22222222-2222-2222-2222-222222222222';
  v_test_owner uuid := '11111111-1111-1111-1111-111111111111';
  v_lumiere_owner uuid := '44444444-4444-4444-4444-444444444444';
  v_enjoye_staff uuid := '33333333-3333-3333-3333-333333333333';
  v_now timestamptz := now();
  v_grant jsonb;
  v_oneshot jsonb;
  v_claim jsonb;
  v_quota jsonb;
  v_arm jsonb;
  v_revoke jsonb;
  v_grant_id text;
  v_oneshot_id text;
  v_count integer;
  v_status text;
begin
  insert into public.staff_auth_memberships
    (id, user_id, auth_user_id, organization_id, role, display_name, is_active)
  values
    ('mem-enjoye-owner', 'staff-001', v_enjoye_owner, 'org-the-enjoye', 'OWNER', 'ENJOYE Owner', true),
    ('mem-beauty-os-test-owner', 'staff-test-1', v_test_owner, 'org-beauty-os-test', 'OWNER', 'TEST Owner', true),
    ('mem-lumiere-owner', 'staff-lumiere-1', v_lumiere_owner, 'org-lumiere', 'OWNER', 'Lumiere Owner', true),
    ('mem-enjoye-staff', 'staff-002', v_enjoye_staff, 'org-the-enjoye', 'STAFF', 'ENJOYE Staff', true);

  insert into public.line_official_accounts (organization_id, channel_id)
  values
    ('org-the-enjoye', '2009219238'),
    ('org-beauty-os-test', '2009219238'),
    ('org-lumiere', '9999999999');

  insert into public.line_broadcasts (id, organization_id, status)
  values
    ('lbr-enjoye-draft-2f1', 'org-the-enjoye', 'draft'),
    ('lbr-test-sending-2f1', 'org-beauty-os-test', 'draft');

  perform tests.assert(
    not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like '%owner_self_reminder%'
        and pg_get_function_identity_arguments(p.oid) ilike '%appointment%'
    ),
    'Production RPCs must not take appointment_id'
  );
  perform tests.assert(
    has_function_privilege(
      'anon',
      'public.grant_line_owner_self_reminder_test(text,boolean)',
      'execute'
    ) is not true,
    'anon must not execute grant'
  );
  perform tests.assert(
    has_function_privilege(
      'service_role',
      'public.grant_line_owner_self_reminder_test(text,boolean)',
      'execute'
    ) is not true,
    'service_role must not execute owner grant'
  );
  perform tests.assert(
    has_function_privilege(
      'authenticated',
      'public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text)',
      'execute'
    ) is not true,
    'authenticated must not execute claim'
  );
  perform tests.assert(
    has_function_privilege(
      'authenticated',
      'public.record_line_owner_self_reminder_quota_snapshot(text,boolean,text,integer,timestamptz)',
      'execute'
    ) is not true,
    'authenticated must not execute quota snapshot'
  );
  perform tests.assert(
    has_function_privilege(
      'authenticated',
      'public.arm_line_owner_self_reminder_production_runtime(text,text)',
      'execute'
    ) is not true,
    'authenticated must not execute production arm'
  );
  perform tests.assert(
    has_function_privilege(
      'anon',
      'public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text)',
      'execute'
    ) is not true,
    'anon must not execute claim'
  );
  perform tests.assert(
    has_function_privilege(
      'service_role',
      'public.claim_line_owner_self_reminder_oneshot(text,text,text,text,text)',
      'execute'
    ) is true,
    'service_role must execute claim'
  );

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  v_grant := public.grant_line_owner_self_reminder_test('org-the-enjoye', true);
  reset role;
  perform tests.assert(
    v_grant->>'ok' = 'false' and v_grant->>'reason' = 'send_closed',
    'unarmed Production runtime must fail-closed'
  );

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  begin
    perform public.arm_line_owner_self_reminder_production_runtime(
      'knccefcxncglgpmvgqlp.supabase.co',
      'production'
    );
    perform tests.assert(false, 'authenticated must not arm runtime');
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  set local role service_role;
  v_arm := public.arm_line_owner_self_reminder_production_runtime(
    'bfzquejrtgqzzarhkiya.supabase.co',
    'preview'
  );
  reset role;
  perform tests.assert(
    v_arm->>'ok' = 'false' and v_arm->>'reason' = 'send_closed',
    'Preview host must not arm Production runtime'
  );
  perform tests.assert(
    not exists (select 1 from public.line_owner_self_reminder_runtime_identity),
    'failed Preview arm must not insert identity'
  );

  set local role service_role;
  v_arm := public.arm_line_owner_self_reminder_production_runtime(
    'knccefcxncglgpmvgqlp.supabase.co',
    'production'
  );
  reset role;
  perform tests.assert(
    v_arm->>'ok' = 'true' and v_arm->>'already_armed' = 'false',
    'local Production host can arm disposable identity only'
  );

  perform tests.become(v_test_owner);
  set local role authenticated;
  begin
    perform public.grant_line_owner_self_reminder_test('org-the-enjoye', true);
    perform tests.assert(false, 'TEST owner must not grant Enjoye');
  exception
    when insufficient_privilege then null;
  end;
  v_grant := public.grant_line_owner_self_reminder_test('org-beauty-os-test', true);
  reset role;
  perform tests.assert(
    v_grant->>'ok' = 'false' and v_grant->>'reason' = 'unauthorized',
    'Preview TEST shop cannot receive Production grant'
  );

  perform tests.become(v_lumiere_owner);
  set local role authenticated;
  v_grant := public.grant_line_owner_self_reminder_test('org-lumiere', true);
  reset role;
  perform tests.assert(
    v_grant->>'ok' = 'false' and v_grant->>'reason' = 'unauthorized',
    'cross-shop Lumiere cannot grant'
  );

  perform tests.become(v_enjoye_staff);
  set local role authenticated;
  begin
    perform public.grant_line_owner_self_reminder_test('org-the-enjoye', true);
    perform tests.assert(false, 'Enjoye staff must not grant');
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  v_grant := public.grant_line_owner_self_reminder_test('org-the-enjoye', false);
  reset role;
  perform tests.assert(
    v_grant->>'ok' = 'false' and v_grant->>'reason' = 'not_consented',
    'no independent consent cannot grant'
  );

  insert into public.line_owner_recipients
    (organization_id, staff_user_id, line_user_id_hint, bind_method, bound_at)
  values
    ('org-the-enjoye', 'cust-2d2-fake-bound', 'manual-hint', 'manual', v_now);
  insert into public.line_owner_recipient_secrets (organization_id, key_id)
  values ('org-the-enjoye', 'not-a-real-key');

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  v_grant := public.grant_line_owner_self_reminder_test('org-the-enjoye', true);
  reset role;
  perform tests.assert(
    v_grant->>'ok' = 'false' and v_grant->>'reason' = 'unbound',
    'fake bind cannot grant'
  );

  update public.line_owner_recipients
  set staff_user_id = 'staff-001',
      line_user_id_hint = '••••fc8c',
      bind_method = 'webhook_code',
      bound_at = v_now
  where organization_id = 'org-the-enjoye';
  update public.line_owner_recipient_secrets
  set key_id = 'line-cred-v1'
  where organization_id = 'org-the-enjoye';

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  v_grant := public.grant_line_owner_self_reminder_test('org-the-enjoye', true);
  reset role;
  perform tests.assert(v_grant->>'ok' = 'true', 'Enjoye Owner with trusted bind can grant locally');
  v_grant_id := v_grant->>'grant_id';

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  v_oneshot := public.issue_line_owner_self_reminder_oneshot('org-the-enjoye', v_grant_id);
  reset role;
  perform tests.assert(v_oneshot->>'ok' = 'true', 'first oneshot can issue after consent');
  v_oneshot_id := v_oneshot->>'oneshot_id';

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  v_oneshot := public.issue_line_owner_self_reminder_oneshot('org-the-enjoye', v_grant_id);
  reset role;
  perform tests.assert(
    v_oneshot->>'ok' = 'false' and v_oneshot->>'reason' = 'duplicate',
    'duplicate oneshot cannot issue'
  );

  update public.line_owner_recipients
  set bound_at = v_now + interval '1 minute',
      line_user_id_hint = '••••rebind'
  where organization_id = 'org-the-enjoye';

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  v_oneshot := public.issue_line_owner_self_reminder_oneshot('org-the-enjoye', v_grant_id);
  reset role;
  perform tests.assert(
    v_oneshot->>'ok' = 'false' and v_oneshot->>'reason' = 'not_consented',
    'rebind must invalidate previous grant'
  );

  update public.line_owner_recipients
  set bound_at = v_now,
      line_user_id_hint = '••••fc8c'
  where organization_id = 'org-the-enjoye';

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  v_revoke := public.revoke_line_owner_self_reminder_test('org-the-enjoye', v_grant_id);
  reset role;
  perform tests.assert(v_revoke->>'ok' = 'true', 'Enjoye Owner can revoke own consent');

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  v_oneshot := public.issue_line_owner_self_reminder_oneshot('org-the-enjoye', v_grant_id);
  reset role;
  perform tests.assert(
    v_oneshot->>'ok' = 'false' and v_oneshot->>'reason' = 'not_consented',
    'revoked grant cannot issue oneshot'
  );

  set local role service_role;
  v_claim := public.claim_line_owner_self_reminder_oneshot(
    'org-the-enjoye',
    v_oneshot_id,
    v_grant_id,
    '確認發送一則給我自己的預約提醒測試',
    'staff-001'
  );
  reset role;
  perform tests.assert(
    v_claim->>'claimed' = 'false',
    'revoked consent cannot be claimed; quota fail-closed may run first'
  );

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  v_grant := public.grant_line_owner_self_reminder_test('org-the-enjoye', true);
  v_grant_id := v_grant->>'grant_id';
  v_oneshot := public.issue_line_owner_self_reminder_oneshot('org-the-enjoye', v_grant_id);
  reset role;
  perform tests.assert(v_grant->>'ok' = 'true' and v_oneshot->>'ok' = 'true', 'fresh grant and oneshot');
  v_oneshot_id := v_oneshot->>'oneshot_id';

  set local role service_role;
  v_claim := public.claim_line_owner_self_reminder_oneshot(
    'org-the-enjoye',
    v_oneshot_id,
    v_grant_id,
    '確認發送一則給我自己的預約提醒測試',
    'staff-001'
  );
  reset role;
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'quota_exceeded',
    'unknown quota must refuse claim'
  );

  set local role service_role;
  v_quota := public.record_line_owner_self_reminder_quota_snapshot(
    '2009219238',
    false,
    'none',
    null,
    v_now
  );
  reset role;
  perform tests.assert(
    v_quota->>'ok' = 'false' and v_quota->>'reason' = 'quota_exceeded',
    'unknown quota snapshot must be rejected'
  );

  set local role service_role;
  v_quota := public.record_line_owner_self_reminder_quota_snapshot(
    '2009219238',
    true,
    'limited',
    3,
    v_now
  );
  reset role;
  perform tests.assert(v_quota->>'ok' = 'true', 'trusted service_role quota can record');

  update public.line_broadcasts
  set status = 'sending'
  where id = 'lbr-test-sending-2f1';

  set local role service_role;
  v_claim := public.claim_line_owner_self_reminder_oneshot(
    'org-the-enjoye',
    v_oneshot_id,
    v_grant_id,
    '確認發送一則給我自己的預約提醒測試',
    'staff-001'
  );
  reset role;
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'inflight',
    'shared channel Broadcast inflight must block Owner-self claim'
  );

  update public.line_broadcasts
  set status = 'draft'
  where id = 'lbr-test-sending-2f1';

  set local role service_role;
  v_claim := public.claim_line_owner_self_reminder_oneshot(
    'org-the-enjoye',
    v_oneshot_id,
    v_grant_id,
    '確認發送一則給我自己的預約提醒測試',
    'staff-001'
  );
  reset role;
  perform tests.assert(v_claim->>'claimed' = 'true', 'trusted claim can mark oneshot claimed');
  perform tests.assert(
    v_claim->>'send_open' = 'false',
    'claim must keep send_open closed'
  );

  set local role service_role;
  v_claim := public.claim_line_owner_self_reminder_oneshot(
    'org-the-enjoye',
    v_oneshot_id,
    v_grant_id,
    '確認發送一則給我自己的預約提醒測試',
    'staff-001'
  );
  reset role;
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'duplicate',
    'repeat claim of the same oneshot must fail'
  );

  perform tests.become(v_enjoye_owner);
  set local role authenticated;
  select count(*) into v_count
  from public.line_owner_self_reminder_grants;
  reset role;
  perform tests.assert(v_count >= 1, 'Enjoye Owner can read own grants via RLS');

  perform tests.become(v_test_owner);
  set local role authenticated;
  select count(*) into v_count
  from public.line_owner_self_reminder_grants;
  reset role;
  perform tests.assert(v_count = 0, 'TEST owner must not read Enjoye grants');

  perform tests.become(v_lumiere_owner);
  set local role authenticated;
  select count(*) into v_count
  from public.line_owner_self_reminder_grants;
  reset role;
  perform tests.assert(v_count = 0, 'Lumiere owner must not read Enjoye grants');

  select status into v_status
  from public.line_broadcasts
  where id = 'lbr-enjoye-draft-2f1';
  perform tests.assert(v_status = 'draft', 'Broadcast draft must stay untouched');
  perform tests.assert(
    not exists (
      select 1 from public.line_broadcasts
      where status in ('sending', 'accepted', 'pending_confirmation')
    ),
    'no Broadcast send status may be opened by Owner-self review'
  );
  perform tests.assert(
    not exists (
      select 1 from public.line_owner_self_reminder_oneshots
      where consumed_at is not null
    ),
    'claim must not consume or send; consumed_at stays null'
  );
end;
$$;
