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
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017161000_line_customer_bindings_preview_upgrade.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017161000_line_customer_bindings_preview_upgrade.sql"
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

confirm_sql() {
  cat <<EOF
select tests.become('11111111-1111-1111-1111-111111111111');
select public.confirm_line_customer_binding('org-the-enjoye', 'cust-2');
EOF
}

psql -d "$DB" -X -q -c "$(confirm_sql)" >/tmp/line-customer-confirm-a.out 2>/tmp/line-customer-confirm-a.err &
psql -d "$DB" -X -q -c "$(confirm_sql)" >/tmp/line-customer-confirm-b.out 2>/tmp/line-customer-confirm-b.err &
wait || true

ACTIVE="$("${PSQL[@]}" -At -c "select count(*) from public.line_customer_bindings where organization_id = 'org-the-enjoye' and customer_id = 'cust-2' and status = 'active' and verified is true and confirmed_at is not null;")"
SECRET="$("${PSQL[@]}" -At -c "select count(*) from public.line_customer_binding_secrets s join public.line_customer_bindings b on b.id = s.binding_id where b.organization_id = 'org-the-enjoye' and b.customer_id = 'cust-2';")"
if [[ "$ACTIVE" != "1" || "$SECRET" != "1" ]]; then
  echo "REFUSE: concurrent confirm left active=$ACTIVE secret=$SECRET." >&2
  exit 1
fi

if "${PSQL[@]}" -c "select tests.become('11111111-1111-1111-1111-111111111111'); select public.confirm_line_customer_binding('org-the-enjoye', 'cust-2');" >/tmp/line-customer-confirm-dup.out 2>/tmp/line-customer-confirm-dup.err; then
  echo "REFUSE: duplicate confirm was accepted." >&2
  exit 1
fi

HASH_Z="$("${PSQL[@]}" -At -c "select encode(sha256(convert_to('Uzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'utf8')), 'hex');")"
"${PSQL[@]}" -c "
insert into public.line_customer_binding_rebinds (
  binding_id, organization_id, customer_id,
  line_user_id_hint, line_user_id_hash, line_user_id_cipher, key_id,
  captured_at, expires_at
)
select
  id, organization_id, customer_id,
  '••••zzzz', '${HASH_Z}', 'v1.cipher-cross-rebind', 'line-cred-v1',
  now(), now() + interval '10 minutes'
from public.line_customer_bindings
where organization_id = 'org-the-enjoye' and customer_id = 'cust-1';

update public.line_customer_bindings
set
  line_user_id_hint = '••••zzzz',
  line_user_id_hash = '${HASH_Z}',
  verified = false,
  status = 'pending',
  bound_at = null,
  confirmed_at = null,
  confirmed_by = null,
  pending_expires_at = now() + interval '10 minutes',
  updated_at = now()
where organization_id = 'org-the-enjoye' and customer_id = 'cust-2';
"

cross_confirm_sql() {
  local customer_id="$1"
  cat <<EOF
select tests.become('11111111-1111-1111-1111-111111111111');
select public.confirm_line_customer_binding('org-the-enjoye', '${customer_id}');
EOF
}

psql -d "$DB" -X -q -c "$(cross_confirm_sql cust-1)" >/tmp/line-customer-cross-a.out 2>/tmp/line-customer-cross-a.err &
psql -d "$DB" -X -q -c "$(cross_confirm_sql cust-2)" >/tmp/line-customer-cross-b.out 2>/tmp/line-customer-cross-b.err &
wait || true

TRUSTED_Z="$("${PSQL[@]}" -At -c "select count(*) from public.line_customer_bindings where line_user_id_hash = '${HASH_Z}' and status = 'active' and verified is true and confirmed_at is not null;")"
if [[ "$TRUSTED_Z" == "0" ]]; then
  # Concurrent identity_taken can reject both sides. Release the staged
  # rebind and confirm the leftover pending capture so exactly one wins.
  "${PSQL[@]}" -c "
    select tests.become('11111111-1111-1111-1111-111111111111');
    select public.cancel_line_customer_rebind('org-the-enjoye', 'cust-1');
    select public.confirm_line_customer_binding('org-the-enjoye', 'cust-2');
  " >/tmp/line-customer-cross-settle.out 2>/tmp/line-customer-cross-settle.err || true
  TRUSTED_Z="$("${PSQL[@]}" -At -c "select count(*) from public.line_customer_bindings where line_user_id_hash = '${HASH_Z}' and status = 'active' and verified is true and confirmed_at is not null;")"
fi
if [[ "$TRUSTED_Z" != "1" ]]; then
  echo "REFUSE: cross-table concurrent confirm left $TRUSTED_Z trusted bindings for the same LINE hash." >&2
  exit 1
fi
INCONSISTENT="$("${PSQL[@]}" -At -c "
select count(*)
from public.line_customer_bindings b
left join public.line_customer_binding_secrets s on s.binding_id = b.id
where b.organization_id = 'org-the-enjoye'
  and (
    (b.verified is true and (b.status is distinct from 'active' or b.confirmed_at is null or s.binding_id is null))
    or (b.status = 'active' and (b.verified is not true or b.confirmed_at is null or s.binding_id is null))
  );
")"
if [[ "$INCONSISTENT" != "0" ]]; then
  echo "REFUSE: cross-table concurrent confirm left inconsistent verified/status/secret rows." >&2
  exit 1
fi
JOB="$("${PSQL[@]}" -At -c "select count(*) from public.line_automation_jobs where id = 'laj-keep-day' and appointment_app_id = 'appt-keep' and status = 'scheduled';")"
if [[ "$JOB" != "1" ]]; then
  echo "REFUSE: Phase 2B appointment job was lost during cross-table confirm." >&2
  exit 1
fi

echo "PASS: local LINE customer bindings verified without dropping Phase 2B jobs or sending LINE."
