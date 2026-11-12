-- Local-only Phase 2B.3 security cases. Never call LINE. Never touch remote DBs.

do $$
declare
  v_test_owner uuid := '11111111-1111-1111-1111-111111111111';
  v_enjoye_owner uuid := '22222222-2222-2222-2222-222222222222';
  v_enjoye_staff uuid := '33333333-3333-3333-3333-333333333333';
  v_text text := E'【LINE 群發功能測試】\n這是一則系統功能測試訊息，無需回覆，謝謝。';
  v_now timestamptz := now();
  v_claim jsonb;
  v_usage jsonb;
  v_finalize jsonb;
  v_accepted_before integer;
  v_accepted_after integer;
  v_status text;
  v_permit timestamptz;
begin
  insert into public.staff_auth_memberships
    (id, user_id, auth_user_id, organization_id, role, display_name, is_active)
  values
    ('mem-test-owner', 'staff-test-1', v_test_owner, 'org-beauty-os-test', 'OWNER', 'TEST Owner', true),
    ('mem-enjoye-owner', 'staff-enjoye-1', v_enjoye_owner, 'org-the-enjoye', 'OWNER', 'ENJOYE Owner', true),
    ('mem-enjoye-staff', 'staff-enjoye-2', v_enjoye_staff, 'org-the-enjoye', 'STAFF', 'ENJOYE Staff', true);

  insert into public.line_official_accounts
    (organization_id, channel_id, bot_display_name, bot_basic_id, broadcast_enabled, broadcast_test_runtime_open)
  values
    ('org-beauty-os-test', '2009219238', 'ai', '@357gospk', false, true),
    ('org-the-enjoye', '2009219238', 'ai', '@357gospk', true, false);

  update public.line_official_accounts
  set broadcast_formal_runtime_open = true
  where organization_id = 'org-the-enjoye';

  insert into public.line_broadcast_oneshot_permits
    (id, organization_id, channel_id, bot_display_name, bot_basic_id, message_sha256)
  values
    (
      'lbrp-local-2b3',
      'org-beauty-os-test',
      '2009219238',
      'ai',
      '@357gospk',
      '68ca91c946ed5b09a90884943fc96c653e7b5ad05d55dcdd7dece071e4a6315e'
    );

  insert into public.line_broadcasts (
    id, organization_id, status, text_body, request_id, created_by_staff_id,
    send_claimed_at, confirmed_at, created_at
  ) values (
    'lbr-7a17faeae137440d',
    'org-beauty-os-test',
    'accepted',
    v_text,
    'lbrq-7a17faeae137440d',
    'staff-test-1',
    '2026-10-11T16:10:00+00',
    '2026-10-11T16:10:00+00',
    '2026-10-11T16:10:00+00'
  );

  insert into public.line_broadcasts (
    id, organization_id, status, text_body, request_id, created_by_staff_id
  ) values
    ('lbr-test-draft-1', 'org-beauty-os-test', 'draft', v_text, 'lbrq-test-draft-1', 'staff-test-1'),
    ('lbr-enjoye-draft-1', 'org-the-enjoye', 'draft', '週年活動通知', 'lbrq-enjoye-draft-1', 'staff-enjoye-1'),
    ('lbr-enjoye-draft-2', 'org-the-enjoye', 'draft', '第二則正式稿', 'lbrq-enjoye-draft-2', 'staff-enjoye-1');

  perform tests.assert(
    (select broadcast_formal_runtime_open from public.line_official_accounts where organization_id = 'org-beauty-os-test') is not true,
    'TEST formal runtime stays closed'
  );
  perform tests.assert(
    not exists (
      select 1 from public.line_broadcasts
      where id = 'lbr-7a17faeae137440d' and status is distinct from 'accepted'
    ),
    'accepted history must remain accepted after fixture load'
  );

  perform tests.assert(
    has_function_privilege('anon', 'public.claim_line_broadcast_send(text,text,text,text,text,boolean,integer,timestamptz)', 'execute') is not true,
    'anon must not execute claim'
  );
  perform tests.assert(
    has_function_privilege('anon', 'public.read_line_broadcast_channel_usage(text)', 'execute') is not true,
    'anon must not execute usage'
  );
  perform tests.assert(
    has_function_privilege('anon', 'public.finalize_stale_line_broadcast_sending_for_channel(text)', 'execute') is not true,
    'anon must not execute channel finalize'
  );
  perform tests.assert(
    has_function_privilege('authenticated', 'public.line_broadcast_consumed_on_taipei_day_for_channel(text,timestamptz)', 'execute') is not true,
    'authenticated must not execute internal channel count'
  );

  perform tests.become(null);
  begin
    perform public.claim_line_broadcast_send(
      'org-the-enjoye', 'lbr-enjoye-draft-1', 'lbrq-enjoye-draft-1', '週年活動通知'
    );
    perform tests.assert(false, 'unauthenticated claim should raise');
  exception
    when insufficient_privilege then null;
  end;

  perform tests.become(v_enjoye_staff);
  begin
    perform public.claim_line_broadcast_send(
      'org-the-enjoye', 'lbr-enjoye-draft-1', 'lbrq-enjoye-draft-1', '週年活動通知',
      'formal', true, 10, v_now
    );
    perform tests.assert(false, 'staff claim should raise');
  exception
    when insufficient_privilege then null;
  end;

  perform tests.become(v_test_owner);
  begin
    perform public.claim_line_broadcast_send(
      'org-the-enjoye', 'lbr-enjoye-draft-1', 'lbrq-enjoye-draft-1', '週年活動通知',
      'formal', true, 10, v_now
    );
    perform tests.assert(false, 'cross-org owner claim should raise');
  exception
    when insufficient_privilege then null;
  end;

  perform tests.become(v_test_owner);
  v_claim := public.claim_line_broadcast_send(
    'org-beauty-os-test', 'lbr-test-draft-1', 'lbrq-test-draft-1', v_text
  );
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'quota_exceeded',
    '4-arg oneshot must fail-closed without quota snapshot'
  );
  perform tests.assert(
    (select consumed_at from public.line_broadcast_oneshot_permits where id = 'lbrp-local-2b3') is null,
    'failed 4-arg claim must not consume the permit'
  );

  v_claim := public.claim_line_broadcast_send(
    'org-beauty-os-test', 'lbr-test-draft-1', 'lbrq-test-draft-1', v_text,
    'oneshot', false, 999, v_now
  );
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'quota_exceeded',
    'unknown quota snapshot must fail-closed'
  );

  v_claim := public.claim_line_broadcast_send(
    'org-beauty-os-test', 'lbr-test-draft-1', 'lbrq-test-draft-1', v_text,
    'oneshot', true, 0, v_now
  );
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'quota_exceeded',
    'zero remaining must fail-closed'
  );

  v_claim := public.claim_line_broadcast_send(
    'org-beauty-os-test', 'lbr-test-draft-1', 'lbrq-test-draft-1', v_text,
    'oneshot', true, 10, v_now - interval '45 seconds'
  );
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'quota_exceeded',
    'stale snapshot must fail-closed'
  );

  v_claim := public.claim_line_broadcast_send(
    'org-beauty-os-test', 'lbr-test-draft-1', 'lbrq-test-draft-1', v_text,
    'oneshot', true, 10, v_now + interval '30 seconds'
  );
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'quota_exceeded',
    'future snapshot must fail-closed'
  );

  perform tests.become(v_enjoye_owner);
  v_usage := public.read_line_broadcast_channel_usage('org-the-enjoye');
  perform tests.assert(v_usage->>'ok' = 'true', 'owner usage read ok');
  perform tests.assert(v_usage->>'quota_confirmed' = 'false', 'usage is never quota confirmation');
  perform tests.assert(v_usage->>'consumed_today' = '1', 'accepted history counts toward Channel daily');
  perform tests.assert(
    coalesce(v_usage::text, '') not like '%【LINE 群發功能測試】%',
    'usage must not leak message bodies'
  );
  perform tests.assert(
    coalesce(v_usage::text, '') not like '%channel_secret%'
    and coalesce(v_usage::text, '') not like '%access_token%',
    'usage must not leak secrets'
  );

  insert into public.line_broadcasts (
    id, organization_id, status, text_body, request_id, created_by_staff_id, send_claimed_at
  ) values
    ('lbr-hist-2', 'org-the-enjoye', 'accepted', '歷史二', 'lbrq-hist-2', 'staff-enjoye-1', v_now),
    ('lbr-hist-3', 'org-beauty-os-test', 'failed', '歷史三', 'lbrq-hist-3', 'staff-test-1', v_now);

  v_claim := public.claim_line_broadcast_send(
    'org-the-enjoye', 'lbr-enjoye-draft-1', 'lbrq-enjoye-draft-1', '週年活動通知',
    'formal', true, 999999, v_now
  );
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'quota_exceeded',
    'forged huge remaining must not replace Channel daily'
  );
  perform tests.assert(
    v_claim->>'quota_confirmed' = 'false',
    'client remaining is not quota confirmation'
  );

  delete from public.line_broadcasts where id in ('lbr-hist-2', 'lbr-hist-3');

  v_accepted_before := (
    select count(*) from public.line_broadcasts
    where id = 'lbr-7a17faeae137440d' and status = 'accepted'
  );
  v_claim := public.claim_line_broadcast_send(
    'org-the-enjoye', 'lbr-enjoye-draft-1', 'lbrq-enjoye-draft-1', '週年活動通知',
    'formal', true, 12, v_now
  );
  perform tests.assert(v_claim->>'claimed' = 'true', 'fresh formal claim should succeed in local fixture');
  perform tests.assert(v_claim->>'quota_confirmed' = 'false', 'successful claim is not LINE quota confirmation');
  v_accepted_after := (
    select count(*) from public.line_broadcasts
    where id = 'lbr-7a17faeae137440d' and status = 'accepted'
      and text_body = v_text
  );
  perform tests.assert(v_accepted_before = 1 and v_accepted_after = 1, 'accepted history must stay untouched');

  v_claim := public.claim_line_broadcast_send(
    'org-the-enjoye', 'lbr-enjoye-draft-1', 'lbrq-enjoye-draft-1', '週年活動通知',
    'formal', true, 12, v_now
  );
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'pending_confirmation',
    'repeat claim on sending row must not resend'
  );

  perform tests.become(v_test_owner);
  v_claim := public.claim_line_broadcast_send(
    'org-beauty-os-test', 'lbr-test-draft-1', 'lbrq-test-draft-1', v_text,
    'oneshot', true, 12, v_now
  );
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'pending_confirmation',
    'peer oneshot must wait while Enjoye sending is inflight'
  );
  perform tests.assert(
    (select consumed_at from public.line_broadcast_oneshot_permits where id = 'lbrp-local-2b3') is null,
    'blocked peer claim must not consume oneshot permit'
  );

  update public.line_broadcasts
  set send_claimed_at = now() - interval '45 seconds',
      confirmed_at = now() - interval '45 seconds',
      updated_at = now() - interval '45 seconds'
  where id = 'lbr-enjoye-draft-1';

  perform tests.become(v_test_owner);
  v_finalize := public.finalize_stale_line_broadcast_sending_for_channel('org-beauty-os-test');
  perform tests.assert(v_finalize->>'ok' = 'true', 'peer may finalize stale sending');
  perform tests.assert((v_finalize->>'finalized_count')::int = 1, 'one stale sending finalized');
  select status into v_status from public.line_broadcasts where id = 'lbr-enjoye-draft-1';
  perform tests.assert(v_status = 'pending_confirmation', 'stale sending becomes pending_confirmation');
  perform tests.assert(
    (select send_claimed_at is not null from public.line_broadcasts where id = 'lbr-enjoye-draft-1'),
    'finalize must not clear send_claimed_at'
  );

  v_claim := public.claim_line_broadcast_send(
    'org-beauty-os-test', 'lbr-test-draft-1', 'lbrq-test-draft-1', v_text,
    'oneshot', true, 12, now()
  );
  perform tests.assert(
    v_claim->>'claimed' = 'false' and v_claim->>'reason' = 'pending_confirmation',
    'pending_confirmation still blocks the shared Channel and must not auto-retry'
  );

  v_finalize := public.finalize_stale_line_broadcast_sending_for_channel('org-beauty-os-test');
  perform tests.assert(
    (v_finalize->>'finalized_count')::int = 0,
    'finalize must not rewrite pending_confirmation or accepted'
  );
  perform tests.assert(
    (select status from public.line_broadcasts where id = 'lbr-7a17faeae137440d') = 'accepted',
    'accepted history still accepted after finalize'
  );

  raise notice 'PHASE_2B3_LOCAL_CASES_PASS';
end;
$$;
