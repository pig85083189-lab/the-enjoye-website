#!/usr/bin/env bash
# Local-only Phase 2B LINE customer binding review.
# Unix socket only. Never connect to Preview / Production. Never call LINE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_customer_bindings_local"
PSQL=(psql -d "$DB" -v ON_ERROR_STOP=1 -X -q)

if [[ -n "${PGHOST:-}" || -n "${DATABASE_URL:-}" || -n "${SUPABASE_DB_URL:-}" ]]; then
  echo "REFUSE: unset PGHOST, DATABASE_URL, and SUPABASE_DB_URL so this stays on the local unix socket." >&2
  exit 1
fi

if [[ "${PGHOST:-}" == *supabase* || "${DATABASE_URL:-}" == *supabase* ]]; then
  echo "REFUSE: remote Supabase connection is not allowed." >&2
  exit 1
fi

pg_isready -q || {
  echo "REFUSE: local PostgreSQL unix socket is not ready." >&2
  exit 1
}

cleanup() {
  dropdb --if-exists "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

dropdb --if-exists "$DB"
createdb "$DB"

"${PSQL[@]}" -f "$ROOT/supabase/tests/line-automation-schedule-engine.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-customer-bindings.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017140000_line_automation_schedule_engine.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017140000_line_automation_schedule_engine.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017160000_line_customer_bindings.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017160000_line_customer_bindings.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-customer-bindings.local-cases.sql"

HMAC_KEY="$(printf 'ab%.0s' {1..32})"
CODE="$("${PSQL[@]}" -At -c "select tests.become('11111111-1111-1111-1111-111111111111'); select public.start_line_customer_bind_challenge('org-the-enjoye', 'cust-2', true, '${HMAC_KEY}')->>'code';" | tail -n1)"
ISSUED="$("${PSQL[@]}" -At -c "select now();")"
HASH_C="$("${PSQL[@]}" -At -c "select encode(sha256(convert_to('Ucccccccccccccccccccccccccccccccc', 'utf8')), 'hex');")"
"${PSQL[@]}" -c "insert into public.line_webhook_events (organization_id, event_id, bound) values ('org-the-enjoye', 'evt-conc-a', false), ('org-the-enjoye', 'evt-conc-b', false);"

proof_sql() {
  local event_id="$1"
  cat <<EOF
select tests.line_customer_bind_proof(
  'org-the-enjoye',
  'token-local',
  '${event_id}',
  '${CODE}',
  '${HASH_C}',
  'v1.cipher-conc',
  '••••cccc',
  'line-cred-v1',
  '${HMAC_KEY}',
  timestamptz '${ISSUED}'
);
EOF
}

PROOF_A="$("${PSQL[@]}" -At -c "$(proof_sql evt-conc-a)")"
PROOF_B="$("${PSQL[@]}" -At -c "$(proof_sql evt-conc-b)")"

consume_sql() {
  local event_id="$1"
  local proof="$2"
  cat <<EOF
select public.consume_line_customer_bind_challenge_public(
  'org-the-enjoye',
  'token-local',
  '${CODE}',
  '${event_id}',
  '${proof}',
  timestamptz '${ISSUED}',
  'v1.cipher-conc',
  '••••cccc',
  '${HASH_C}',
  'line-cred-v1'
);
EOF
}

psql -d "$DB" -v ON_ERROR_STOP=1 -X -q -c "$(consume_sql evt-conc-a "$PROOF_A")" &
psql -d "$DB" -v ON_ERROR_STOP=1 -X -q -c "$(consume_sql evt-conc-b "$PROOF_B")" &
wait

CAPTURED="$("${PSQL[@]}" -At -c "select count(*) from public.line_customer_bindings where organization_id = 'org-the-enjoye' and customer_id = 'cust-2' and status = 'pending';")"
if [[ "$CAPTURED" != "1" ]]; then
  echo "REFUSE: concurrent webhook consume created $CAPTURED pending bindings." >&2
  exit 1
fi

echo "PASS: local LINE customer bindings verified without dropping Phase 2B jobs or sending LINE."
