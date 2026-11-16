#!/usr/bin/env bash
# Isolated LINE eligibility and cross-database receipt alignment.
# Unix socket only. Never connect to Preview or Production. Never debit a real wallet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FINANCE="beauty_os_line_checkout_gate_finance"
BOOKING="beauty_os_line_checkout_gate_booking"
PSQL=(psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q)

if [[ -n "${PGHOST:-}" || -n "${DATABASE_URL:-}" || -n "${SUPABASE_DB_URL:-}" ]]; then
  echo "REFUSE: unset PGHOST, DATABASE_URL, and SUPABASE_DB_URL so this stays on the local unix socket." >&2
  exit 1
fi

pg_isready -q || {
  echo "REFUSE: local PostgreSQL unix socket is not ready." >&2
  exit 1
}

cleanup() {
  dropdb --if-exists "$FINANCE" >/dev/null 2>&1 || true
  dropdb --if-exists "$BOOKING" >/dev/null 2>&1 || true
}
trap cleanup EXIT

dropdb --if-exists "$FINANCE"
dropdb --if-exists "$BOOKING"
createdb "$FINANCE"
createdb "$BOOKING"

"${PSQL[@]}" -f "$ROOT/supabase/tests/stored-value-checkout-atomic.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115140000_customer_wallet_identity.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115170000_booking_source_customer_links.sql"
"${PSQL[@]}" <<'SQL'
insert into public.locations (id, organization_id, app_id, name, is_active)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'loc-isolated', '隔離', true);
insert into public.staff_auth_memberships (id, user_id, auth_user_id, organization_id, role, is_active)
values ('mem-owner', 'staff-owner-test', '99999999-9999-4999-8999-999999999999', 'org-stored-value-test', 'OWNER', true);
insert into public.customers (id, organization_id, status, app_id) values
  ('c1000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-hist-keep'),
  ('c2000000-0000-4000-8000-0000000000c2', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-current-wallet'),
  ('c2100000-0000-4000-8000-0000000000c2', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-current-booking'),
  ('c3000000-0000-4000-8000-0000000000c3', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-none-wallet'),
  ('c3100000-0000-4000-8000-0000000000c3', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-none-booking'),
  ('c4000000-0000-4000-8000-0000000000c4', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-revoked-wallet'),
  ('c4100000-0000-4000-8000-0000000000c4', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-revoked-booking'),
  ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-pending-wallet'),
  ('c5100000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-pending-booking');
insert into public.appointments (id, organization_id, status)
values ('a1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'COMPLETED');
insert into public.stored_value_accounts (id, organization_id, customer_id, currency, status) values
  ('d1000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'c1000000-0000-4000-8000-0000000000c1', 'TWD', 'ACTIVE'),
  ('d3000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'c3000000-0000-4000-8000-0000000000c3', 'TWD', 'ACTIVE'),
  ('d4000000-0000-4000-8000-0000000000d4', '11111111-1111-4111-8111-111111111111', 'c4000000-0000-4000-8000-0000000000c4', 'TWD', 'ACTIVE'),
  ('d5000000-0000-4000-8000-0000000000d5', '11111111-1111-4111-8111-111111111111', 'c5000000-0000-4000-8000-0000000000c5', 'TWD', 'ACTIVE');
insert into public.stored_value_ledger_entries (
  organization_id, account_id, customer_id, type, amount_delta_minor, reason, effect_key, created_by_staff_id
) values
  ('11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-0000000000d1', 'c1000000-0000-4000-8000-0000000000c1', 'TOP_UP', 700, 'HISTORICAL', 'seed:hist', 'staff-owner-test'),
  ('11111111-1111-4111-8111-111111111111', 'd3000000-0000-4000-8000-0000000000d3', 'c3000000-0000-4000-8000-0000000000c3', 'TOP_UP', 1000, 'HISTORICAL', 'seed:none', 'staff-owner-test'),
  ('11111111-1111-4111-8111-111111111111', 'd4000000-0000-4000-8000-0000000000d4', 'c4000000-0000-4000-8000-0000000000c4', 'TOP_UP', 1000, 'HISTORICAL', 'seed:revoked', 'staff-owner-test'),
  ('11111111-1111-4111-8111-111111111111', 'd5000000-0000-4000-8000-0000000000d5', 'c5000000-0000-4000-8000-0000000000c5', 'TOP_UP', 1000, 'HISTORICAL', 'seed:pending', 'staff-owner-test');
SQL

psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql"
psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/migrations/20261116143000_stored_value_line_checkout_gate.sql"
psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/migrations/20261116143000_stored_value_line_checkout_gate.sql"

"${PSQL[@]}" <<'SQL'
insert into public.line_customer_bindings (
  organization_id, customer_uuid, status, verified, confirmed_at, bound_at, line_user_id_hash
) values (
  'org-stored-value-test', 'c2000000-0000-4000-8000-0000000000c2', 'active', true, now(), now(), repeat('ab', 32)
);
insert into public.line_customer_bindings (
  organization_id, customer_uuid, status, verified, confirmed_at, bound_at, line_user_id_hash
) values (
  'org-stored-value-test', 'c4000000-0000-4000-8000-0000000000c4', 'active', true,
  now() - interval '2 days', now() - interval '2 days', repeat('cd', 32)
);
insert into public.line_customer_bindings (
  organization_id, customer_uuid, status, verified, line_user_id_hash
) values (
  'org-stored-value-test', 'c5000000-0000-4000-8000-0000000000c5', 'pending', false, repeat('ef', 32)
);
SQL
"${PSQL[@]}" -f "$ROOT/supabase/tests/stored-value-line-checkout-gate.local-cases.sql"

psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/tests/booking-checkout-receipt-compat.local-stub.sql"
psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/booking/20261115171000_checkout_stored_value_receipt.sql"

ORG="11111111-1111-4111-8111-111111111111"
claim() {
  psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -tA -c \
    "select public.claim_stored_value_debit_receipt('$ORG', '$1', '$2', $3, 'booking-checkout:$1')"
}
commit_receipt() {
  psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -tA -c \
    "select public.commit_stored_value_debit_receipt('$ORG', '$1', '$2', $3, 'booking-checkout:$1')"
}
settle() {
  psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q -c \
    "select set_config('tests.uid', '99999999-9999-4999-8999-999999999999', false); select public.settle_booking_source_checkout('org-stored-value-test', '$1', '$2', 'loc-isolated', $3, 'staff-owner-test');"
}

status="$(claim sale-align-0001 src-current-0001 400)"
[[ "$status" == "PENDING" ]]
settle src-current-0001 sale-align-0001 400
# Timeout after the finance commit: the receipt is still PENDING and there is one payment.
pending="$(psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -tA -c "select status from public.stored_value_debit_receipts where checkout_app_id = 'sale-align-0001'")"
payments="$(psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -tA -c "select count(*) from public.stored_value_ledger_entries where effect_key = 'booking-checkout:sale-align-0001'")"
[[ "$pending" == "PENDING" && "$payments" == "1" ]]
status="$(claim sale-align-0001 src-current-0001 400)"
[[ "$status" == "PENDING" ]]
settle src-current-0001 sale-align-0001 400
posted="$(commit_receipt sale-align-0001 src-current-0001 400)"
[[ "$posted" == "POSTED" ]]
payments="$(psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -tA -c "select count(*) from public.stored_value_ledger_entries where effect_key = 'booking-checkout:sale-align-0001'")"
balance="$(psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -tA -c "select coalesce(sum(amount_delta_minor), 0) from public.stored_value_ledger_entries where customer_id = 'c2000000-0000-4000-8000-0000000000c2'")"
[[ "$payments" == "1" && "$balance" == "1600" ]]
status="$(claim sale-align-0001 src-current-0001 400)"
[[ "$status" == "POSTED" ]]
if psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q -c "select public.abandon_stored_value_debit_receipt('$ORG', 'sale-align-0001', 'src-current-0001', 400, 'booking-checkout:sale-align-0001')" >/tmp/abandon-posted.txt 2>&1; then
  echo "posted receipt was abandoned" >&2
  exit 1
fi

status="$(claim sale-align-high src-current-0001 999999)"
[[ "$status" == "PENDING" ]]
if settle src-current-0001 sale-align-high 999999 >/tmp/align-high.txt 2>&1; then
  echo "overdraft debit was accepted" >&2
  exit 1
fi
grep -q "儲值金餘額不足" /tmp/align-high.txt
psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q -c \
  "select public.abandon_stored_value_debit_receipt('$ORG', 'sale-align-high', 'src-current-0001', 999999, 'booking-checkout:sale-align-high')" >/dev/null
failed="$(psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -tA -c "select status from public.stored_value_debit_receipts where checkout_app_id = 'sale-align-high'")"
high_payments="$(psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -tA -c "select count(*) from public.stored_value_ledger_entries where effect_key = 'booking-checkout:sale-align-high'")"
hist="$(psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -tA -c "select amount_delta_minor::text || ':' || (select status from public.appointments where id = 'a1000000-0000-4000-8000-0000000000a1') from public.stored_value_ledger_entries where effect_key = 'seed:hist'")"
[[ "$failed" == "FAILED" && "$high_payments" == "0" && "$hist" == "700:COMPLETED" && "$balance" == "1600" ]]

echo "line checkout gate and receipt alignment passed"
