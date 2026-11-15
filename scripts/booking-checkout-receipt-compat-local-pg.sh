#!/usr/bin/env bash
# Isolated booking checkout compatibility proof.
# Unix socket only. Never connect to Preview or Production. Never debit a real wallet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_booking_receipt_compat_local"
PSQL=(psql -d "$DB" -v ON_ERROR_STOP=1 -X -q)

if [[ -n "${PGHOST:-}" || -n "${DATABASE_URL:-}" || -n "${SUPABASE_DB_URL:-}" ]]; then
  echo "REFUSE: unset PGHOST, DATABASE_URL, and SUPABASE_DB_URL so this stays on the local unix socket." >&2
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

"${PSQL[@]}" -f "$ROOT/supabase/tests/booking-checkout-receipt-compat.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/booking/20261115171000_checkout_stored_value_receipt.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/booking-checkout-receipt-compat.local-cases.sql"

"${PSQL[@]}" <<'SQL'
select set_config('tests.uid', '99999999-9999-4999-8999-999999999999', false);
select tests.open_draft('concurrent-sale', 800, 200);
select public.save_checkout_draft(
  'concurrent-sale',
  tests.draft_updated_at('concurrent-sale'),
  '[{"method":"STORED_VALUE","amount":200}]'::jsonb,
  '[]'::jsonb,
  jsonb_build_object('customerPackageId', 'cpkg-compat-0001', 'serviceId', 'svc-compat-0001', 'sessions', 1)
);
insert into public.stored_value_debit_receipts (
  organization_id, checkout_app_id, source_customer_key, amount_minor, effect_key, status
) values (
  '11111111-1111-4111-8111-111111111111',
  'concurrent-sale',
  'src-compat-0001',
  200,
  'booking-checkout:concurrent-sale',
  'POSTED'
);
SQL

CONCURRENT="select set_config('tests.uid', '99999999-9999-4999-8999-999999999999', false); select public.settle_checkout_draft('concurrent-sale', tests.draft_updated_at('concurrent-sale'));"
psql -d "$DB" -v ON_ERROR_STOP=1 -X -c "$CONCURRENT" >/tmp/booking-concurrent-a.txt 2>&1 &
pid_a=$!
psql -d "$DB" -v ON_ERROR_STOP=1 -X -c "$CONCURRENT" >/tmp/booking-concurrent-b.txt 2>&1 &
pid_b=$!
status_a=0
status_b=0
wait "$pid_a" || status_a=$?
wait "$pid_b" || status_b=$?
echo "concurrent booking settles exit: $status_a $status_b"
echo "--- concurrent A ---"
cat /tmp/booking-concurrent-a.txt
echo "--- concurrent B ---"
cat /tmp/booking-concurrent-b.txt

"${PSQL[@]}" <<'SQL'
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.transactions t
  join public.checkout_drafts d on d.id = t.checkout_draft_id
  where d.app_id = 'concurrent-sale' and t.status = 'COMPLETED';
  if v_count <> 1 then
    raise exception 'concurrent stored-value settle created % transactions', v_count;
  end if;
  if (select count(*) from public.transaction_payments p
        join public.transactions t on t.id = p.transaction_id
        join public.checkout_drafts d on d.id = t.checkout_draft_id
       where d.app_id = 'concurrent-sale' and p.method = 'STORED_VALUE' and p.amount_minor = 200) <> 1 then
    raise exception 'concurrent stored-value settle duplicated the payment';
  end if;
  if (select t.package_redemption from public.transactions t
        join public.checkout_drafts d on d.id = t.checkout_draft_id
       where d.app_id = 'concurrent-sale')
     <> jsonb_build_object('customerPackageId', 'cpkg-compat-0001', 'serviceId', 'svc-compat-0001', 'sessions', 1) then
    raise exception 'concurrent settle dropped package redemption';
  end if;
  if to_regclass('public.stored_value_ledger_entries') is not null then
    raise exception 'booking compatibility database has a stored-value ledger';
  end if;
end $$;
SQL

echo "booking checkout receipt compatibility cases passed"
