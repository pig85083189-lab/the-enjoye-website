#!/usr/bin/env bash
# Local-only LINE delivery task ledger review.
# Unix socket only. Never connect to Preview / Production. Never call LINE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_delivery_tasks_local"
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
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-delivery-tasks.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017140000_line_automation_schedule_engine.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017140000_line_automation_schedule_engine.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017160000_line_customer_bindings.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017160000_line_customer_bindings.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017161000_line_customer_bindings_preview_upgrade.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017161000_line_customer_bindings_preview_upgrade.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261021120000_line_delivery_tasks.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261021120000_line_delivery_tasks.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-delivery-tasks.local-cases.sql"

KEY_A="$("${PSQL[@]}" -At -c "select '10:automation|14:org-the-enjoye|18:appt-keep:day_before|6:cust-2';")"
KEY_B="$("${PSQL[@]}" -At -c "select '10:automation|14:org-the-enjoye|12:crash-restart|6:cust-2';")"
KEY_C="$("${PSQL[@]}" -At -c "select '10:automation|14:org-the-enjoye|7:timeout|6:cust-2';")"
KEY_D="$("${PSQL[@]}" -At -c "select '10:automation|14:org-the-enjoye|7:unknown|6:cust-2';")"
KEY_E="$("${PSQL[@]}" -At -c "select '10:automation|14:org-the-enjoye|6:unbind|6:cust-2';")"
KEY_BC="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|12:broadcast-1|8:audience';")"
KEY_BL="$("${PSQL[@]}" -At -c "select '9:broadcast|11:org-lumiere|12:broadcast-1|8:audience';")"

enqueue() {
  local org="$1"
  local kind="$2"
  local key="$3"
  local recipient="$4"
  "${PSQL[@]}" -At -c "
    select tests.become('11111111-1111-1111-1111-111111111111');
    select public.enqueue_line_delivery_task('${org}', '${kind}', '${key}', '${recipient}');
  "
}

claim_sql() {
  local org="$1"
  local key="$2"
  cat <<EOF
select tests.become('11111111-1111-1111-1111-111111111111');
select public.claim_line_delivery_task('${org}', '${key}');
EOF
}

DUP="$(enqueue org-the-enjoye automation "$KEY_A" cust-2)"
if [[ "$DUP" != *'"ok": true'* && "$DUP" != *'"ok":true'* ]]; then
  echo "REFUSE: first enqueue was not accepted: $DUP" >&2
  exit 1
fi
DUP2="$(enqueue org-the-enjoye automation "$KEY_A" cust-2)"
if [[ "$DUP2" != *duplicate* ]]; then
  echo "REFUSE: duplicate delivery_key was accepted: $DUP2" >&2
  exit 1
fi

psql -d "$DB" -X -q -c "$(claim_sql org-the-enjoye "$KEY_A")" >/tmp/line-delivery-claim-a.out 2>/tmp/line-delivery-claim-a.err &
psql -d "$DB" -X -q -c "$(claim_sql org-the-enjoye "$KEY_A")" >/tmp/line-delivery-claim-b.out 2>/tmp/line-delivery-claim-b.err &
wait || true

CLAIMED="$("${PSQL[@]}" -At -c "select count(*) from public.line_delivery_tasks where delivery_key = '${KEY_A}' and status = 'claimed' and attempt_count = 1;")"
if [[ "$CLAIMED" != "1" ]]; then
  echo "REFUSE: concurrent claim left claimed=$CLAIMED for $KEY_A." >&2
  cat /tmp/line-delivery-claim-a.out /tmp/line-delivery-claim-a.err /tmp/line-delivery-claim-b.out /tmp/line-delivery-claim-b.err >&2 || true
  exit 1
fi

ACCEPT="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.complete_line_delivery_task('org-the-enjoye', '${KEY_A}', 'accepted');
")"
if [[ "$ACCEPT" != *'"ok": true'* && "$ACCEPT" != *'"ok":true'* ]]; then
  echo "REFUSE: accepted complete failed: $ACCEPT" >&2
  exit 1
fi
RECLAIM_A="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_A}');
")"
if [[ "$RECLAIM_A" != *duplicate* ]]; then
  echo "REFUSE: accepted task was claimed again: $RECLAIM_A" >&2
  exit 1
fi

enqueue org-the-enjoye automation "$KEY_B" cust-2 >/dev/null
"${PSQL[@]}" -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_B}');
" >/dev/null
# Simulate worker crash: claimed row is left as-is, then a new session tries again.
RESTART="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_B}');
")"
if [[ "$RESTART" != *duplicate* ]]; then
  echo "REFUSE: claimed task was resent after restart: $RESTART" >&2
  exit 1
fi

enqueue org-the-enjoye automation "$KEY_C" cust-2 >/dev/null
"${PSQL[@]}" -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_C}');
" >/dev/null
TIMEOUT="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.complete_line_delivery_task('org-the-enjoye', '${KEY_C}', 'accepted', 'timeout', 'timeout', true, null);
")"
if [[ "$TIMEOUT" != *pending_confirmation* ]]; then
  echo "REFUSE: timeout did not become pending_confirmation: $TIMEOUT" >&2
  exit 1
fi
RECLAIM_C="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_C}');
")"
if [[ "$RECLAIM_C" != *duplicate* ]]; then
  echo "REFUSE: timeout task was retried: $RECLAIM_C" >&2
  exit 1
fi

enqueue org-the-enjoye automation "$KEY_D" cust-2 >/dev/null
"${PSQL[@]}" -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_D}');
" >/dev/null
UNKNOWN="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.complete_line_delivery_task('org-the-enjoye', '${KEY_D}', 'failed', 'unknown', 'unknown', false, 503);
")"
if [[ "$UNKNOWN" != *pending_confirmation* ]]; then
  echo "REFUSE: unknown 5xx did not become pending_confirmation: $UNKNOWN" >&2
  exit 1
fi

enqueue org-the-enjoye automation "$KEY_E" cust-2 >/dev/null
"${PSQL[@]}" -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.unbind_line_customer_binding('org-the-enjoye', 'cust-2');
" >/dev/null
UNBIND_CLAIM="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_E}');
")"
if [[ "$UNBIND_CLAIM" != *recipient_not_ready* ]]; then
  echo "REFUSE: unbound customer was still claimed: $UNBIND_CLAIM" >&2
  exit 1
fi
UNBIND_STATUS="$("${PSQL[@]}" -At -c "select status from public.line_delivery_tasks where delivery_key = '${KEY_E}';")"
if [[ "$UNBIND_STATUS" != "blocked" ]]; then
  echo "REFUSE: unbound claim left status=$UNBIND_STATUS." >&2
  exit 1
fi

CROSS="$("${PSQL[@]}" -At -c "
  select tests.become('22222222-2222-2222-2222-222222222222');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_A}');
" 2>/tmp/line-delivery-cross.err || true)"
if [[ "$CROSS" == *'"ok": true'* || "$CROSS" == *'"ok":true'* ]]; then
  echo "REFUSE: cross-org claim succeeded: $CROSS" >&2
  exit 1
fi
if ! grep -q unauthorized /tmp/line-delivery-cross.err; then
  echo "REFUSE: cross-org claim did not raise unauthorized." >&2
  cat /tmp/line-delivery-cross.err >&2 || true
  exit 1
fi

enqueue org-the-enjoye broadcast "$KEY_BC" audience >/dev/null
BC_CLAIM="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_BC}');
")"
if [[ "$BC_CLAIM" != *'"ok": true'* && "$BC_CLAIM" != *'"ok":true'* ]]; then
  echo "REFUSE: eligible broadcast claim failed: $BC_CLAIM" >&2
  exit 1
fi

# Lumiere owner enqueue + claim should block on broadcast_enabled=false,
# and must not consult customer LINE binding.
"${PSQL[@]}" -c "
  select tests.become('22222222-2222-2222-2222-222222222222');
  select public.enqueue_line_delivery_task('org-lumiere', 'broadcast', '${KEY_BL}', 'audience');
  select public.claim_line_delivery_task('org-lumiere', '${KEY_BL}');
" >/tmp/line-delivery-lumiere.out 2>/tmp/line-delivery-lumiere.err || true
LUMIERE="$("${PSQL[@]}" -At -c "select status, last_error_class from public.line_delivery_tasks where delivery_key = '${KEY_BL}';")"
if [[ "$LUMIERE" != *blocked*broadcast_not_eligible* ]]; then
  echo "REFUSE: ineligible broadcast was not blocked: $LUMIERE" >&2
  cat /tmp/line-delivery-lumiere.out /tmp/line-delivery-lumiere.err >&2 || true
  exit 1
fi

PLAINTEXT="$("${PSQL[@]}" -At -c "
select count(*) from information_schema.columns
where table_schema = 'public'
  and table_name = 'line_delivery_tasks'
  and column_name in ('line_user_id', 'line_user_id_cipher', 'channel_access_token', 'channel_secret');
")"
if [[ "$PLAINTEXT" != "0" ]]; then
  echo "REFUSE: delivery task table stored LINE credentials." >&2
  exit 1
fi

JOBS="$("${PSQL[@]}" -At -c "select count(*) from public.line_automation_jobs;")"
if [[ "$JOBS" != "5" ]]; then
  echo "REFUSE: delivery task migration mutated automation jobs count=$JOBS." >&2
  exit 1
fi

echo "PASS: local LINE delivery tasks claimed without sending LINE."
