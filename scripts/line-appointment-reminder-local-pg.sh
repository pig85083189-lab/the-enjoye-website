#!/usr/bin/env bash
# Local-only Phase 2B PostgreSQL review. Unix socket only.
# Never connect to Preview / Production. Never call LINE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_reminder_2b_local"
PSQL=(psql -d "$DB" -v ON_ERROR_STOP=1 -X -q)

if [[ "${PGHOST:-}" != "" || "${DATABASE_URL:-}" != "" ]]; then
  echo "REFUSE: unset PGHOST and DATABASE_URL so this stays on the local unix socket." >&2
  exit 1
fi

dropdb --if-exists "$DB"
createdb "$DB"

"${PSQL[@]}" -f "$ROOT/supabase/tests/line-appointment-reminder.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261013120000_line_appointment_reminder_automation.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-appointment-reminder.local-cases.sql"

"${PSQL[@]}" <<'SQL'
update public.line_automation_jobs
set status = 'canceled'
where status in ('scheduled', 'claimed');

insert into public.line_automation_jobs (
  id, organization_id, appointment_app_id, customer_app_id, service_app_id,
  timing_id, fingerprint, scheduled_for, status, request_id
) values
  ('laj-conc-a000000001', 'org-the-enjoye', 'apt-conc-a', 'cust-1', 'svc-1',
   'hours_before_3', 'fp-conc-a', now() - interval '1 minute', 'scheduled', 'larq-conc-a000000001'),
  ('laj-conc-b000000001', 'org-lumiere', 'apt-conc-b', 'cust-9', 'svc-9',
   'hours_before_3', 'fp-conc-b', now() - interval '1 minute', 'scheduled', 'larq-conc-b000000001');
SQL

"${PSQL[@]}" <<'SQL' > /tmp/line-reminder-2b-session-a.log 2>&1 &
set session authorization service_role;
begin;
select public.claim_line_appointment_reminder_job(
  'org-the-enjoye',
  'larq-conc-a000000001',
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
set session authorization service_role;
select public.claim_line_appointment_reminder_job(
  'org-lumiere',
  'larq-conc-b000000001',
  true,
  20,
  now()
);
SQL
)"
wait "$A_PID"

if ! grep -q '"ok": true' /tmp/line-reminder-2b-session-a.log; then
  echo "CONCURRENCY FAIL: session A should claim" >&2
  cat /tmp/line-reminder-2b-session-a.log >&2
  exit 1
fi
echo "$B_OUT" | grep -q '"ok": false' || {
  echo "CONCURRENCY FAIL: peer claim should not succeed" >&2
  echo "$B_OUT" >&2
  exit 1
}

echo "line-appointment-reminder local pg passed"
