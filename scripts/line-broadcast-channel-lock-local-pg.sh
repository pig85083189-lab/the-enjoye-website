#!/usr/bin/env bash
# Local-only Phase 2B.3 PostgreSQL review. Unix socket only.
# Never connect to Preview / Production. Never call LINE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_2b3_local"
PSQL=(psql -d "$DB" -v ON_ERROR_STOP=1 -X -q)

if [[ "${PGHOST:-}" != "" || "${DATABASE_URL:-}" != "" ]]; then
  echo "REFUSE: unset PGHOST and DATABASE_URL so this stays on the local unix socket." >&2
  exit 1
fi

dropdb --if-exists "$DB"
createdb "$DB"

"${PSQL[@]}" -f "$ROOT/supabase/tests/line-broadcast-channel-lock.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261012120000_line_broadcast_channel_lock.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261012120000_line_broadcast_channel_lock.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-broadcast-channel-lock.local-cases.sql"

"${PSQL[@]}" <<'SQL'
update public.line_broadcasts
set status = 'accepted',
    api_result = 'accepted'
where status in ('sending', 'pending_confirmation')
  and id is distinct from 'lbr-7a17faeae137440d';

insert into public.line_broadcasts (
  id, organization_id, status, text_body, request_id, created_by_staff_id
) values
  ('lbr-conc-enjoye', 'org-the-enjoye', 'draft', '並發正式稿', 'lbrq-conc-enjoye', 'staff-enjoye-1'),
  ('lbr-conc-test', 'org-beauty-os-test', 'draft', E'【LINE 群發功能測試】\n這是一則系統功能測試訊息，無需回覆，謝謝。', 'lbrq-conc-test', 'staff-test-1'),
  ('lbr-roll-enjoye', 'org-the-enjoye', 'draft', '回滾稿', 'lbrq-roll-enjoye', 'staff-enjoye-1');
SQL

"${PSQL[@]}" <<'SQL' > /tmp/line-2b3-session-a.log 2>&1 &
begin;
select tests.become('22222222-2222-2222-2222-222222222222');
select public.claim_line_broadcast_send(
  'org-the-enjoye',
  'lbr-conc-enjoye',
  'lbrq-conc-enjoye',
  '並發正式稿',
  'formal',
  true,
  20,
  now()
);
select pg_sleep(2);
commit;
SQL
A_PID=$!
sleep 0.5

B_OUT="$("${PSQL[@]}" -At <<'SQL'
select tests.become('11111111-1111-1111-1111-111111111111');
select public.claim_line_broadcast_send(
  'org-beauty-os-test',
  'lbr-conc-test',
  'lbrq-conc-test',
  E'【LINE 群發功能測試】\n這是一則系統功能測試訊息，無需回覆，謝謝。',
  'oneshot',
  true,
  20,
  now()
);
SQL
)"
wait "$A_PID"

if ! grep -q '"claimed": true' /tmp/line-2b3-session-a.log; then
  echo "CONCURRENCY FAIL: session A should claim" >&2
  cat /tmp/line-2b3-session-a.log >&2
  exit 1
fi
echo "$B_OUT" | grep -q '"claimed": false' || {
  echo "CONCURRENCY FAIL: peer claim should not succeed" >&2
  echo "$B_OUT" >&2
  exit 1
}
echo "$B_OUT" | grep -q 'pending_confirmation' || {
  echo "CONCURRENCY FAIL: peer should see inflight pending_confirmation" >&2
  echo "$B_OUT" >&2
  exit 1
}

"${PSQL[@]}" <<'SQL'
delete from public.line_broadcasts
where id in ('lbr-conc-enjoye', 'lbr-enjoye-draft-1');

do $$
declare
  v_claim jsonb;
  v_status text;
begin
  begin
    perform tests.become('22222222-2222-2222-2222-222222222222');
    v_claim := public.claim_line_broadcast_send(
      'org-the-enjoye',
      'lbr-roll-enjoye',
      'lbrq-roll-enjoye',
      '回滾稿',
      'formal',
      true,
      20,
      now()
    );
    perform tests.assert(v_claim->>'claimed' = 'true', 'rollback setup claim');
    raise exception 'rollback-2b3' using errcode = 'P0001';
  exception
    when raise_exception then
      if sqlerrm is distinct from 'rollback-2b3' then
        raise;
      end if;
  end;

  select status into v_status from public.line_broadcasts where id = 'lbr-roll-enjoye';
  perform tests.assert(v_status = 'draft', 'rolled-back claim must leave the draft untouched');
  perform tests.assert(
    (select status from public.line_broadcasts where id = 'lbr-7a17faeae137440d') = 'accepted',
    'accepted history survives rollback test'
  );
end;
$$;
SQL

dropdb "$DB"
echo "PHASE_2B3_LOCAL_PG_PASS"
