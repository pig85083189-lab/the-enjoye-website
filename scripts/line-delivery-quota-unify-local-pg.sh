#!/usr/bin/env bash
# Local-only Phase 3E shared Broadcast quota unify review.
# Calls official claim_line_broadcast_send and delivery claims together.
# Unix socket only. Never connect to Preview / Production. Never call LINE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_delivery_quota_unify_local"
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
LOCK_FILE="$LOCK_DIR/beauty_os_line_delivery_quota_unify_local.lock"
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
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-delivery-broadcast-quota-unify.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017140000_line_automation_schedule_engine.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017160000_line_customer_bindings.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017161000_line_customer_bindings_preview_upgrade.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261021120000_line_delivery_tasks.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261021130000_line_delivery_worker.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261021140000_line_delivery_broadcast_quota_unify.sql"
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

enqueue_as() {
  local uid="$1"
  local org="$2"
  local kind="$3"
  local key="$4"
  local recipient="$5"
  "${PSQL[@]}" -At -c "
    select tests.become('${uid}');
    select public.enqueue_line_delivery_task('${org}', '${kind}', '${key}', '${recipient}');
  "
}

seed_official_draft() {
  local org="$1"
  local bid="$2"
  local rid="$3"
  "${PSQL[@]}" -c "
    insert into public.line_broadcasts (
      id, organization_id, status, text_body, request_id, created_by_staff_id
    ) values (
      '${bid}', '${org}', 'draft', 'Phase 3E local quota unify test', '${rid}', 'staff-enjoye-owner'
    )
    on conflict (id) do update
    set status = 'draft',
        request_id = excluded.request_id,
        send_claimed_at = null,
        confirmed_at = null,
        text_body = excluded.text_body;
  " >/dev/null
}

official_claim_sql() {
  local org="$1"
  local bid="$2"
  local rid="$3"
  local uid="$4"
  cat <<EOF
select tests.become('${uid}');
select public.claim_line_broadcast_send(
  '${org}',
  '${bid}',
  '${rid}',
  'Phase 3E local quota unify test',
  'formal',
  true,
  100,
  now()
);
EOF
}

delivery_claim_sql() {
  local org="$1"
  local key="$2"
  local uid="$3"
  cat <<EOF
select tests.become('${uid}');
select public.claim_line_delivery_task('${org}', '${key}');
EOF
}

json_claimed() {
  local payload="$1"
  [[ "$payload" == *'"claimed": true'* || "$payload" == *'"claimed":true'* ]]
}

json_ok() {
  local payload="$1"
  [[ "$payload" == *'"ok": true'* || "$payload" == *'"ok":true'* ]]
}

OWNER_ENJOYE="11111111-1111-1111-1111-111111111111"
OWNER_LUMIERE="22222222-2222-2222-2222-222222222222"

YESTERDAY="$("${PSQL[@]}" -At -c "
  select (((now() at time zone 'Asia/Taipei')::date - 1)::timestamp at time zone 'Asia/Taipei');
")"

"${PSQL[@]}" -c "
  insert into public.line_broadcasts (
    id, organization_id, status, text_body, request_id, created_by_staff_id, send_claimed_at
  ) values (
    'lbr-unify-yday', 'org-the-enjoye', 'accepted', 'yesterday official',
    'lbrq-unify-yday', 'staff-enjoye-owner', '${YESTERDAY}'::timestamptz
  );
  insert into public.line_delivery_tasks (
    id, organization_id, delivery_key, kind, recipient_id, status,
    attempt_count, claimed_at, created_at, updated_at
  ) values (
    'ldt-unify-yday', 'org-the-enjoye',
    '9:broadcast|14:org-the-enjoye|12:lbr-unify-yd|8:audience',
    'broadcast', 'audience', 'claimed', 1,
    '${YESTERDAY}'::timestamptz, '${YESTERDAY}'::timestamptz, '${YESTERDAY}'::timestamptz
  );
" >/dev/null

CROSS_OFFICIAL="$("${PSQL[@]}" -At -c "select public.line_broadcast_consumed_on_taipei_day('org-the-enjoye');")"
CROSS_USED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$CROSS_OFFICIAL" != "0" || "$CROSS_USED" != "0" ]]; then
  echo "REFUSE: yesterday official/delivery still counted today official=$CROSS_OFFICIAL used=$CROSS_USED." >&2
  exit 1
fi

# Same campaign, many recipients, counts as one slot.
for recip in cust-a cust-b cust-c; do
  KEY_MULTI="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|10:camp-multi|6:${recip}';")"
  enqueue org-the-enjoye broadcast "$KEY_MULTI" "$recip" >/dev/null
  MULTI_CLAIM="$("${PSQL[@]}" -At -c "
    select tests.become('${OWNER_ENJOYE}');
    select public.claim_line_delivery_task('org-the-enjoye', '${KEY_MULTI}');
  ")"
  if ! json_ok "$MULTI_CLAIM"; then
    echo "REFUSE: same-campaign recipient ${recip} was not claimed: $MULTI_CLAIM" >&2
    exit 1
  fi
done
MULTI_USED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
MULTI_OFFICIAL="$("${PSQL[@]}" -At -c "select public.line_broadcast_consumed_on_taipei_day('org-the-enjoye');")"
if [[ "$MULTI_USED" != "1" || "$MULTI_OFFICIAL" != "1" ]]; then
  echo "REFUSE: same campaign recipients over-counted used=$MULTI_USED official=$MULTI_OFFICIAL." >&2
  exit 1
fi

# Failed completion releases the campaign slot.
FAIL_KEY="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|10:camp-multi|6:cust-a';")"
FAIL_RELEASE="$("${PSQL[@]}" -At -c "
  select tests.become('${OWNER_ENJOYE}');
  select public.complete_line_delivery_task(
    'org-the-enjoye', '${FAIL_KEY}', 'failed', 'released after multi', 'invalid_request', false, 400
  );
")"
if [[ "$FAIL_RELEASE" != *failed* ]]; then
  echo "REFUSE: failed delivery still could not complete: $FAIL_RELEASE" >&2
  exit 1
fi
# Remaining two recipients of camp-multi still never-resend, so used stays 1.
AFTER_ONE_FAIL="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$AFTER_ONE_FAIL" != "1" ]]; then
  echo "REFUSE: failing one recipient of a live campaign changed used=$AFTER_ONE_FAIL." >&2
  exit 1
fi

"${PSQL[@]}" -c "
  select tests.become('${OWNER_ENJOYE}');
  select public.complete_line_delivery_task(
    'org-the-enjoye',
    '9:broadcast|14:org-the-enjoye|10:camp-multi|6:cust-b',
    'failed', 'released b', 'invalid_request', false, 400
  );
  select public.complete_line_delivery_task(
    'org-the-enjoye',
    '9:broadcast|14:org-the-enjoye|10:camp-multi|6:cust-c',
    'failed', 'released c', 'invalid_request', false, 400
  );
" >/dev/null
AFTER_RELEASE="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$AFTER_RELEASE" != "0" ]]; then
  echo "REFUSE: failed delivery still consumed quota used=$AFTER_RELEASE." >&2
  exit 1
fi

# Timeout keeps the shared slot visible to official consumed.
KEY_TIMEOUT="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|12:camp-timeout|8:audience';")"
enqueue org-the-enjoye broadcast "$KEY_TIMEOUT" audience >/dev/null
"${PSQL[@]}" -c "
  select tests.become('${OWNER_ENJOYE}');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_TIMEOUT}');
" >/dev/null
"${PSQL[@]}" -c "
  select tests.become('${OWNER_ENJOYE}');
  select public.complete_line_delivery_task(
    'org-the-enjoye', '${KEY_TIMEOUT}', 'accepted', 'timeout', 'timeout', true, null
  );
" >/dev/null
TIMEOUT_STATUS="$("${PSQL[@]}" -At -c "select status from public.line_delivery_tasks where delivery_key = '${KEY_TIMEOUT}';")"
AFTER_TIMEOUT="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
AFTER_TIMEOUT_OFFICIAL="$("${PSQL[@]}" -At -c "select public.line_broadcast_consumed_on_taipei_day('org-the-enjoye');")"
if [[ "$TIMEOUT_STATUS" != "pending_confirmation" || "$AFTER_TIMEOUT" != "1" || "$AFTER_TIMEOUT_OFFICIAL" != "1" ]]; then
  echo "REFUSE: timeout did not keep shared pending_confirmation status=$TIMEOUT_STATUS used=$AFTER_TIMEOUT official=$AFTER_TIMEOUT_OFFICIAL." >&2
  exit 1
fi

# Duplicate campaign across ledgers must refuse the official claim.
KEY_DUP="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|16:lbr-unify-dup001|8:audience';")"
enqueue org-the-enjoye broadcast "$KEY_DUP" audience >/dev/null
DUP_DELIVERY="$("${PSQL[@]}" -At -c "
  select tests.become('${OWNER_ENJOYE}');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_DUP}');
")"
if ! json_ok "$DUP_DELIVERY"; then
  echo "REFUSE: duplicate-campaign delivery claim failed: $DUP_DELIVERY" >&2
  exit 1
fi
seed_official_draft org-the-enjoye lbr-unify-dup001 lbrq-unify-dup001
DUP_OFFICIAL="$("${PSQL[@]}" -At -c "$(official_claim_sql org-the-enjoye lbr-unify-dup001 lbrq-unify-dup001 "$OWNER_ENJOYE")")"
if json_claimed "$DUP_OFFICIAL"; then
  echo "REFUSE: official claim consumed a campaign already on the delivery ledger: $DUP_OFFICIAL" >&2
  exit 1
fi
if [[ "$DUP_OFFICIAL" != *duplicate* && "$DUP_OFFICIAL" != *無法對應* && "$DUP_OFFICIAL" != *發送帳本* ]]; then
  echo "REFUSE: official same-campaign refuse was not fail-closed: $DUP_OFFICIAL" >&2
  exit 1
fi
DUP_USED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$DUP_USED" != "2" ]]; then
  echo "REFUSE: same campaign was double-counted used=$DUP_USED." >&2
  exit 1
fi

# Reverse direction: official first, then delivery of the same campaign.
seed_official_draft org-the-enjoye lbr-unify-dup002 lbrq-unify-dup002
OFFICIAL_FIRST="$("${PSQL[@]}" -At -c "$(official_claim_sql org-the-enjoye lbr-unify-dup002 lbrq-unify-dup002 "$OWNER_ENJOYE")")"
if ! json_claimed "$OFFICIAL_FIRST"; then
  echo "REFUSE: official first claim failed: $OFFICIAL_FIRST" >&2
  exit 1
fi
KEY_DUP2="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|16:lbr-unify-dup002|8:audience';")"
enqueue org-the-enjoye broadcast "$KEY_DUP2" audience >/dev/null
DUP2_DELIVERY="$("${PSQL[@]}" -At -c "
  select tests.become('${OWNER_ENJOYE}');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_DUP2}');
")"
if [[ "$DUP2_DELIVERY" != *broadcast_not_eligible* ]]; then
  echo "REFUSE: delivery claimed a campaign already on the official ledger: $DUP2_DELIVERY" >&2
  exit 1
fi
DUP2_USED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$DUP2_USED" != "3" ]]; then
  echo "REFUSE: official-first campaign did not fill the shared cap used=$DUP2_USED." >&2
  exit 1
fi

# Unparseable never-resend key fail-closes further claims. Reset occupied rows first.
"${PSQL[@]}" -c "
  update public.line_delivery_tasks
  set status = 'failed', last_error_class = 'invalid_request', updated_at = now()
  where organization_id = 'org-the-enjoye'
    and kind = 'broadcast'
    and status in ('claimed', 'accepted', 'pending_confirmation');
  update public.line_broadcasts
  set status = 'accepted'
  where organization_id = 'org-the-enjoye'
    and status = 'sending';
" >/dev/null

"${PSQL[@]}" -c "
  insert into public.line_delivery_tasks (
    id, organization_id, delivery_key, kind, recipient_id, status,
    attempt_count, claimed_at, created_at, updated_at
  ) values (
    'ldt-unify-bad-key', 'org-the-enjoye',
    'not-a-valid-delivery-key',
    'broadcast', 'audience', 'claimed', 1, now(), now(), now()
  );
" >/dev/null
AMBIGUOUS_USED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
AMBIGUOUS_OFFICIAL="$("${PSQL[@]}" -At -c "select public.line_broadcast_consumed_on_taipei_day('org-the-enjoye');")"
if [[ "$AMBIGUOUS_USED" != "3" || "$AMBIGUOUS_OFFICIAL" != "3" ]]; then
  echo "REFUSE: unparseable key did not fail-close used=$AMBIGUOUS_USED official=$AMBIGUOUS_OFFICIAL." >&2
  exit 1
fi
KEY_AFTER_BAD="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|12:camp-after-b|8:audience';")"
enqueue org-the-enjoye broadcast "$KEY_AFTER_BAD" audience >/dev/null
BAD_CLAIM="$("${PSQL[@]}" -At -c "
  select tests.become('${OWNER_ENJOYE}');
  select public.claim_line_delivery_task('org-the-enjoye', '${KEY_AFTER_BAD}');
")"
if [[ "$BAD_CLAIM" != *broadcast_not_eligible* ]]; then
  echo "REFUSE: unparseable mapping still allowed a delivery claim: $BAD_CLAIM" >&2
  exit 1
fi
seed_official_draft org-the-enjoye lbr-unify-after-b lbrq-unify-after-b
BAD_OFFICIAL="$("${PSQL[@]}" -At -c "$(official_claim_sql org-the-enjoye lbr-unify-after-b lbrq-unify-after-b "$OWNER_ENJOYE")")"
if json_claimed "$BAD_OFFICIAL"; then
  echo "REFUSE: unparseable mapping still allowed an official claim: $BAD_OFFICIAL" >&2
  exit 1
fi

"${PSQL[@]}" -c "
  delete from public.line_delivery_tasks where id = 'ldt-unify-bad-key';
  update public.line_delivery_tasks
  set status = 'failed', last_error_class = 'invalid_request', updated_at = now()
  where organization_id = 'org-the-enjoye'
    and kind = 'broadcast'
    and status in ('claimed', 'accepted', 'pending_confirmation', 'blocked');
  update public.line_broadcasts
  set status = 'accepted'
  where organization_id = 'org-the-enjoye'
    and status in ('sending', 'draft');
" >/dev/null

# Remaining 1 slot: two official seeds, then race one official claim + two delivery campaigns.
"${PSQL[@]}" -c "
  delete from public.line_broadcasts
  where organization_id = 'org-the-enjoye'
    and id <> 'lbr-unify-yday';
  delete from public.line_delivery_tasks
  where organization_id = 'org-the-enjoye'
    and kind = 'broadcast';
  insert into public.line_broadcasts (
    id, organization_id, status, text_body, request_id, created_by_staff_id, send_claimed_at
  ) values
    ('lbr-unify-seed-1', 'org-the-enjoye', 'accepted', 'seed 1', 'lbrq-unify-seed-1', 'staff-enjoye-owner', now()),
    ('lbr-unify-seed-2', 'org-the-enjoye', 'accepted', 'seed 2', 'lbrq-unify-seed-2', 'staff-enjoye-owner', now());
" >/dev/null
SEED_USED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$SEED_USED" != "2" ]]; then
  echo "REFUSE: remaining-1 setup did not start at 2 used=$SEED_USED." >&2
  exit 1
fi

KEY_RACE_A="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|11:camp-race-a|8:audience';")"
KEY_RACE_B="$("${PSQL[@]}" -At -c "select '9:broadcast|14:org-the-enjoye|11:camp-race-b|8:audience';")"
enqueue org-the-enjoye broadcast "$KEY_RACE_A" audience >/dev/null
enqueue org-the-enjoye broadcast "$KEY_RACE_B" audience >/dev/null
seed_official_draft org-the-enjoye lbr-unify-race-1 lbrq-unify-race-1

psql -d "$DB" -X -q -c "$(official_claim_sql org-the-enjoye lbr-unify-race-1 lbrq-unify-race-1 "$OWNER_ENJOYE")" \
  >/tmp/line-delivery-unify-official.out 2>/tmp/line-delivery-unify-official.err &
psql -d "$DB" -X -q -c "$(delivery_claim_sql org-the-enjoye "$KEY_RACE_A" "$OWNER_ENJOYE")" \
  >/tmp/line-delivery-unify-del-a.out 2>/tmp/line-delivery-unify-del-a.err &
psql -d "$DB" -X -q -c "$(delivery_claim_sql org-the-enjoye "$KEY_RACE_B" "$OWNER_ENJOYE")" \
  >/tmp/line-delivery-unify-del-b.out 2>/tmp/line-delivery-unify-del-b.err &
wait || true

RACE_USED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
RACE_OFFICIAL="$("${PSQL[@]}" -At -c "select public.line_broadcast_consumed_on_taipei_day('org-the-enjoye');")"
OFFICIAL_WIN="$("${PSQL[@]}" -At -c "select count(*) from public.line_broadcasts where id = 'lbr-unify-race-1' and send_claimed_at is not null;")"
DELIVERY_WIN="$("${PSQL[@]}" -At -c "
  select count(*) from public.line_delivery_tasks
  where organization_id = 'org-the-enjoye'
    and delivery_key in ('${KEY_RACE_A}', '${KEY_RACE_B}')
    and status in ('claimed', 'accepted', 'pending_confirmation');
")"
if [[ "$RACE_USED" != "3" || "$RACE_OFFICIAL" != "3" ]]; then
  echo "REFUSE: remaining-1 dual claim exceeded or missed the shared cap used=$RACE_USED official=$RACE_OFFICIAL." >&2
  cat /tmp/line-delivery-unify-official.out /tmp/line-delivery-unify-official.err \
    /tmp/line-delivery-unify-del-a.out /tmp/line-delivery-unify-del-a.err \
    /tmp/line-delivery-unify-del-b.out /tmp/line-delivery-unify-del-b.err >&2 || true
  exit 1
fi
if [[ $((OFFICIAL_WIN + DELIVERY_WIN)) -ne 1 ]]; then
  echo "REFUSE: remaining-1 race winners official=$OFFICIAL_WIN delivery=$DELIVERY_WIN." >&2
  cat /tmp/line-delivery-unify-official.out /tmp/line-delivery-unify-official.err \
    /tmp/line-delivery-unify-del-a.out /tmp/line-delivery-unify-del-a.err \
    /tmp/line-delivery-unify-del-b.out /tmp/line-delivery-unify-del-b.err >&2 || true
  exit 1
fi

# Different organization is isolated from THE ENJOYE cap.
KEY_LUMIERE="$("${PSQL[@]}" -At -c "select '9:broadcast|11:org-lumiere|12:camp-lumiere|8:audience';")"
enqueue_as "$OWNER_LUMIERE" org-lumiere broadcast "$KEY_LUMIERE" audience >/dev/null
LUMIERE_CLAIM="$("${PSQL[@]}" -At -c "
  select tests.become('${OWNER_LUMIERE}');
  select public.claim_line_delivery_task('org-lumiere', '${KEY_LUMIERE}');
")"
if ! json_ok "$LUMIERE_CLAIM"; then
  echo "REFUSE: lumiere delivery was blocked by enjoye quota: $LUMIERE_CLAIM" >&2
  exit 1
fi
LUMIERE_USED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-lumiere');")"
ENJOYE_USED="$("${PSQL[@]}" -At -c "select public.line_delivery_broadcast_quota_used('org-the-enjoye');")"
if [[ "$LUMIERE_USED" != "1" || "$ENJOYE_USED" != "3" ]]; then
  echo "REFUSE: org isolation failed lumiere=$LUMIERE_USED enjoye=$ENJOYE_USED." >&2
  exit 1
fi

seed_official_draft org-lumiere lbr-unify-lumiere lbrq-unify-lumiere
"${PSQL[@]}" -c "
  update public.line_broadcasts
  set created_by_staff_id = 'staff-lumiere-owner'
  where id = 'lbr-unify-lumiere';
" >/dev/null
LUMIERE_OFFICIAL="$("${PSQL[@]}" -At -c "$(official_claim_sql org-lumiere lbr-unify-lumiere lbrq-unify-lumiere "$OWNER_LUMIERE")")"
if ! json_claimed "$LUMIERE_OFFICIAL"; then
  echo "REFUSE: lumiere official claim was blocked by enjoye quota: $LUMIERE_OFFICIAL" >&2
  exit 1
fi

ANON_CLAIM="$("${PSQL[@]}" -At -c "select has_function_privilege('anon', 'public.claim_line_broadcast_send(text,text,text,text,text,boolean,integer,timestamptz)', 'EXECUTE');")"
ANON_SHARED="$("${PSQL[@]}" -At -c "select has_function_privilege('anon', 'public.line_broadcast_shared_quota_used(text,timestamptz)', 'EXECUTE');")"
ANON_DELIVERY="$("${PSQL[@]}" -At -c "select has_function_privilege('anon', 'public.claim_line_delivery_task(text,text)', 'EXECUTE');")"
if [[ "$ANON_CLAIM" != "f" || "$ANON_SHARED" != "f" || "$ANON_DELIVERY" != "f" ]]; then
  echo "REFUSE: anon still has unify execute privilege." >&2
  exit 1
fi

JOBS="$("${PSQL[@]}" -At -c "select count(*) from public.line_automation_jobs;")"
if [[ "$JOBS" != "5" ]]; then
  echo "REFUSE: quota unify mutated automation jobs count=$JOBS." >&2
  exit 1
fi

echo "PASS: local LINE delivery quota unify kept official+delivery inside 3 without sending LINE."
