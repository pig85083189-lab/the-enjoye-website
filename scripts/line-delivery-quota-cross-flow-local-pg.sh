#!/usr/bin/env bash
# Local-only cross-flow Broadcast quota review for delivery tasks.
# Seeds official line_broadcasts rows. Never calls claim_line_broadcast_send.
# Unix socket only. Never connect to Preview / Production. Never call LINE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_delivery_quota_local"
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

LOCK_DIR="${TMPDIR:-/tmp}"
LOCK_FILE="$LOCK_DIR/beauty_os_line_delivery_quota_local.lock"
exec 9>"$LOCK_FILE"
flock 9

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
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017160000_line_customer_bindings.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017161000_line_customer_bindings_preview_upgrade.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261021120000_line_delivery_tasks.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261021130000_line_delivery_worker.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-delivery-tasks.local-cases.sql"

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

claim_next_sql() {
  cat <<EOF
select tests.become('11111111-1111-1111-1111-111111111111');
select public.claim_next_line_delivery_task('org-the-enjoye');
EOF
}

YESTERDAY="$("${PSQL[@]}" -At -c "
  select (((now() at time zone 'Asia/Taipei')::date - 1)::timestamp at time zone 'Asia/Taipei');
")"

# Yesterday official + yesterday claimed delivery must not consume today's cap.
"${PSQL[@]}" -c "
  insert into public.line_broadcasts (id, organization_id, status, send_claimed_at)
  values ('lb-yesterday', 'org-the-enjoye', 'accepted', '${YESTERDAY}'::timestamptz);
  insert into public.line_delivery_tasks (
    id, organization_id, delivery_key, kind, recipient_id, status,
    attempt_count, claimed_at, created_at, updated_at
  ) values (
    'ldt-yesterday-broadcast', 'org-the-enjoye',
    '9:broadcast|14:org-the-enjoye|9:yesterkey|8:audience',
    'broadcast', 'audience', 'claimed', 1,
    '${YESTERDAY}'::timestamptz, '${YESTERDAY}'::timestamptz, '${YESTERDAY}'::timestamptz
  );
" >/dev/null

CROSS_DAY_OFFICIAL="$("${PSQL[@]}" -At -c "select public.line_broadcast_consumed_on_taipei_day('org-the-enjoye');")"
CROSS_DAY_USED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$CROSS_DAY_OFFICIAL" != "0" || "$CROSS_DAY_USED" != "0" ]]; then
  echo "REFUSE: yesterday official/delivery still counted today official=$CROSS_DAY_OFFICIAL used=$CROSS_DAY_USED." >&2
  exit 1
fi

KEY_TODAY="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|10:cross-day|8:audience';")"
enqueue org-the-enjoye broadcast "$KEY_TODAY" audience >/dev/null
CROSS_DAY_CLAIM="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_TODAY}');
")"
if [[ "$CROSS_DAY_CLAIM" != *'"ok": true'* && "$CROSS_DAY_CLAIM" != *'"ok":true'* ]]; then
  echo "REFUSE: cross-day delivery claim failed: $CROSS_DAY_CLAIM" >&2
  exit 1
fi

# Failed completion must release the delivery slot; timeout keeps it.
FAIL_AFTER_CROSS="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.complete_line_delivery_task(
    'org-the-enjoye', '${KEY_TODAY}', 'failed', 'released after cross-day', 'invalid_request', false, 400
  );
")"
if [[ "$FAIL_AFTER_CROSS" != *failed* ]]; then
  echo "REFUSE: cross-day claimed task could not be failed: $FAIL_AFTER_CROSS" >&2
  exit 1
fi
AFTER_RELEASE="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$AFTER_RELEASE" != "0" ]]; then
  echo "REFUSE: failed delivery still consumed quota used=$AFTER_RELEASE." >&2
  exit 1
fi

KEY_TIMEOUT="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|7:timeout|8:audience';")"
enqueue org-the-enjoye broadcast "$KEY_TIMEOUT" audience >/dev/null
"${PSQL[@]}" -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_TIMEOUT}');
" >/dev/null
AFTER_TIMEOUT_CLAIM="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
"${PSQL[@]}" -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.complete_line_delivery_task(
    'org-the-enjoye', '${KEY_TIMEOUT}', 'accepted', 'timeout', 'timeout', true, null
  );
" >/dev/null
TIMEOUT_STATUS="$("${PSQL[@]}" -At -c "select status from public.line_delivery_tasks where delivery_key = '${KEY_TIMEOUT}';")"
AFTER_TIMEOUT="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$AFTER_TIMEOUT_CLAIM" != "1" || "$TIMEOUT_STATUS" != "pending_confirmation" || "$AFTER_TIMEOUT" != "1" ]]; then
  echo "REFUSE: timeout did not keep pending_confirmation quota claim=$AFTER_TIMEOUT_CLAIM status=$TIMEOUT_STATUS used=$AFTER_TIMEOUT." >&2
  exit 1
fi

# Blocked rows never consume.
"${PSQL[@]}" -c "
  insert into public.line_delivery_tasks (
    id, organization_id, delivery_key, kind, recipient_id, status,
    last_error_class, created_at, updated_at
  ) values (
    'ldt-blocked-quota', 'org-the-enjoye',
    '9:broadcast|14:org-the-enjoye|7:blocked|8:audience',
    'broadcast', 'audience', 'blocked', 'broadcast_not_eligible', now(), now()
  );
" >/dev/null
AFTER_BLOCKED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$AFTER_BLOCKED" != "1" ]]; then
  echo "REFUSE: blocked delivery consumed quota used=$AFTER_BLOCKED." >&2
  exit 1
fi

# Official helper ignores delivery tasks; delivery quota counts them.
OFFICIAL_IGNORES="$("${PSQL[@]}" -At -c "select public.line_broadcast_consumed_on_taipei_day('org-the-enjoye');")"
if [[ "$OFFICIAL_IGNORES" != "0" ]]; then
  echo "REFUSE: official consumed counted delivery tasks official=$OFFICIAL_IGNORES." >&2
  exit 1
fi

# Release the timeout slot so the official+delivery race starts from a clean shared cap.
"${PSQL[@]}" -c "
  update public.line_delivery_tasks
  set status = 'failed', last_error_class = 'invalid_request', updated_at = now()
  where organization_id = 'org-the-enjoye'
    and kind = 'broadcast'
    and status in ('claimed', 'accepted', 'pending_confirmation')
    and (
      coalesce(claimed_at, updated_at, created_at) at time zone 'Asia/Taipei'
    )::date = (now() at time zone 'Asia/Taipei')::date;
" >/dev/null

# Seed two official claims today, then race three delivery workers. Remaining slot = 1.
# This seeds line_broadcasts only. It does not call claim_line_broadcast_send.
"${PSQL[@]}" -c "
  insert into public.line_broadcasts (id, organization_id, status, send_claimed_at)
  values
    ('lb-today-1', 'org-the-enjoye', 'accepted', now()),
    ('lb-today-2', 'org-the-enjoye', 'sending', now());
" >/dev/null

for i in 1 2 3; do
  KEY_X="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|8:cross-${i}|8:audience';")"
  enqueue org-the-enjoye broadcast "$KEY_X" audience >/dev/null
done

psql -d "$DB" -X -q -c "$(claim_next_sql)" >/tmp/line-delivery-quota-a.out 2>/tmp/line-delivery-quota-a.err &
psql -d "$DB" -X -q -c "$(claim_next_sql)" >/tmp/line-delivery-quota-b.out 2>/tmp/line-delivery-quota-b.err &
psql -d "$DB" -X -q -c "$(claim_next_sql)" >/tmp/line-delivery-quota-c.out 2>/tmp/line-delivery-quota-c.err &
wait || true

OFFICIAL_TODAY="$("${PSQL[@]}" -At -c "select public.line_broadcast_consumed_on_taipei_day('org-the-enjoye');")"
USED_TODAY="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
DELIVERY_NEVER="$("${PSQL[@]}" -At -c "
  select count(*) from public.line_delivery_tasks
  where organization_id = 'org-the-enjoye'
    and kind = 'broadcast'
    and status in ('claimed', 'accepted', 'pending_confirmation')
    and (
      coalesce(claimed_at, updated_at, created_at) at time zone 'Asia/Taipei'
    )::date = (now() at time zone 'Asia/Taipei')::date;
")"
BLOCKED_TODAY="$("${PSQL[@]}" -At -c "
  select count(*) from public.line_delivery_tasks
  where organization_id = 'org-the-enjoye'
    and kind = 'broadcast'
    and status = 'blocked'
    and last_error_class = 'broadcast_not_eligible'
    and delivery_key like '%cross-%';
")"
if [[ "$OFFICIAL_TODAY" != "2" ]]; then
  echo "REFUSE: official consumed changed during delivery workers official=$OFFICIAL_TODAY." >&2
  exit 1
fi
if [[ "$DELIVERY_NEVER" != "1" || "$USED_TODAY" != "3" ]]; then
  echo "REFUSE: cross-flow quota mismatch official=$OFFICIAL_TODAY delivery=$DELIVERY_NEVER used=$USED_TODAY." >&2
  cat /tmp/line-delivery-quota-a.out /tmp/line-delivery-quota-a.err \
    /tmp/line-delivery-quota-b.out /tmp/line-delivery-quota-b.err \
    /tmp/line-delivery-quota-c.out /tmp/line-delivery-quota-c.err >&2 || true
  exit 1
fi
if [[ "$BLOCKED_TODAY" != "2" ]]; then
  echo "REFUSE: leftover cross-flow keys were not blocked blocked=$BLOCKED_TODAY." >&2
  exit 1
fi

# Official 3 today must block any further delivery claim without calling official send.
"${PSQL[@]}" -c "
  insert into public.line_broadcasts (id, organization_id, status, send_claimed_at)
  values ('lb-today-3', 'org-the-enjoye', 'accepted', now());
" >/dev/null
KEY_FULL="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|4:full|8:audience';")"
enqueue org-the-enjoye broadcast "$KEY_FULL" audience >/dev/null
FULL_CLAIM="$("${PSQL[@]}" -At -c "
  select tests.become('11111111-1111-1111-1111-111111111111');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_FULL}');
")"
if [[ "$FULL_CLAIM" != *broadcast_not_eligible* ]]; then
  echo "REFUSE: official cap of 3 still allowed a delivery claim: $FULL_CLAIM" >&2
  exit 1
fi

JOBS="$("${PSQL[@]}" -At -c "select count(*) from public.line_automation_jobs;")"
if [[ "$JOBS" != "5" ]]; then
  echo "REFUSE: quota review mutated automation jobs count=$JOBS." >&2
  exit 1
fi

echo "PASS: local LINE delivery cross-flow quota stayed closed without sending LINE."
