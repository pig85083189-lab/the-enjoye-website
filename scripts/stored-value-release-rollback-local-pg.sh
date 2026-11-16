#!/usr/bin/env bash
# Rehearse PR #84 on two isolated local databases.
# Loads the production commit's checkout and top-up definitions, exports only
# function, trigger, and privilege SQL, applies the three release files, then
# restores that export. Ledger rows and receipt rows are counted, never deleted.
# Unix socket only. Never connect to Preview or Production.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREIMAGE="05924b3d69a362b937eb31a261ce8bdfee659a58"
FINANCE="beauty_os_release_rollback_finance"
BOOKING="beauty_os_release_rollback_booking"
OUT="$ROOT/supabase/rollback"
WORKDIR="$(mktemp -d)"

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
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

dropdb --if-exists "$FINANCE"
dropdb --if-exists "$BOOKING"
createdb "$FINANCE"
createdb "$BOOKING"

git -C "$ROOT" show "$PREIMAGE:supabase/beauty-os/stored_value_top_up_line_gate_v2.sql" > "$WORKDIR/topup-preimage.sql"
git -C "$ROOT" show "$PREIMAGE:supabase/booking/20261115171000_checkout_stored_value_receipt.sql" > "$WORKDIR/receipt-preimage.sql"

psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/tests/stored-value-checkout-atomic.local-stub.sql"
psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/migrations/20261115140000_customer_wallet_identity.sql"
psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/migrations/20261115170000_booking_source_customer_links.sql"
psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q <<'SQL'
insert into public.locations (id, organization_id, app_id, name, is_active)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'loc-isolated', '隔離', true);
insert into public.customers (id, organization_id, status, app_id)
values ('c1000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-hist-keep');
insert into public.stored_value_accounts (id, organization_id, customer_id, currency, status)
values ('d1000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'c1000000-0000-4000-8000-0000000000c1', 'TWD', 'ACTIVE');
insert into public.stored_value_ledger_entries (
  organization_id, account_id, customer_id, type, amount_delta_minor, reason, effect_key, created_by_staff_id
) values (
  '11111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-0000000000d1',
  'c1000000-0000-4000-8000-0000000000c1',
  'TOP_UP', 210000, 'HISTORICAL', 'seed:release-rollback', 'staff-owner-test'
);
SQL
psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q -f "$WORKDIR/topup-preimage.sql"

psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/tests/booking-checkout-receipt-compat.local-stub.sql"
psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$ begin
  create type public.staff_role as enum ('OWNER', 'MANAGER', 'STAFF');
exception when duplicate_object then null;
end $$;
do $$ begin
  if to_regprocedure('public.staff_role_can_checkout(public.staff_role)') is null then
    create function public.staff_role_can_checkout(public.staff_role)
    returns boolean language sql immutable as $fn$ select true $fn$;
  end if;
  if to_regprocedure('public.current_operational_staff_id(uuid)') is null then
    create function public.current_operational_staff_id(uuid)
    returns text language sql stable as $fn$ select 'staff-owner-test'::text $fn$;
  end if;
  if to_regprocedure('public.commerce_transaction_json(public.transactions)') is null then
    create function public.commerce_transaction_json(public.transactions)
    returns jsonb language sql stable as $fn$ select '{}'::jsonb $fn$;
  end if;
  if to_regprocedure('public.hydrate_checkout_from_treatment(text,text)') is null then
    create function public.hydrate_checkout_from_treatment(text, text)
    returns jsonb language sql stable as $fn$ select '{}'::jsonb $fn$;
  end if;
end $$;
SQL
psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q -f "$WORKDIR/receipt-preimage.sql"

export_catalog() {
  local db="$1"
  local catalog="$2"
  local dest="$3"
  psql -d "$db" -v ON_ERROR_STOP=1 -X -q -A -t -v "catalog=$catalog" \
    -f "$ROOT/supabase/rollback/export-replaced-catalog.sql" > "$dest"
  if grep -E -q 'postgres://|eyJ[A-Za-z0-9_-]{20,}|sb_secret_|service_role_key' "$dest"; then
    echo "REFUSE: catalog export contains a credential-like value." >&2
    exit 1
  fi
  if [[ ! -s "$dest" ]]; then
    echo "REFUSE: $catalog catalog export is empty." >&2
    exit 1
  fi
}

psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q -A -t <<'SQL' > "$WORKDIR/finance-before.txt"
select md5(pg_get_functiondef('public.settle_booking_source_checkout(text,text,text,text,bigint,text)'::regprocedure));
select md5(pg_get_functiondef('public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)'::regprocedure));
select count(*) from public.stored_value_ledger_entries;
select count(*) from pg_trigger
 where tgname = 'trg_stored_value_ledger_immutable'
   and tgrelid = 'public.stored_value_ledger_entries'::regclass
   and not tgisinternal;
select count(*) from pg_trigger
 where tgname = 'trg_stored_value_ledger_current_line'
   and not tgisinternal;
select has_function_privilege('service_role', 'public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)', 'EXECUTE');
select has_function_privilege('anon', 'public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)', 'EXECUTE');
select has_function_privilege('authenticated', 'public.settle_booking_source_checkout(text,text,text,text,bigint,text)', 'EXECUTE');
select has_function_privilege('service_role', 'public.settle_booking_source_checkout(text,text,text,text,bigint,text)', 'EXECUTE');
SQL

psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q -A -t <<'SQL' > "$WORKDIR/booking-before.txt"
select md5(pg_get_functiondef('public.save_checkout_draft(text,timestamptz,jsonb,jsonb)'::regprocedure));
select md5(pg_get_functiondef('public.settle_checkout_draft(text,timestamptz)'::regprocedure));
select to_regprocedure('public.save_checkout_draft(text,timestamptz,jsonb,jsonb,jsonb)') is null;
select to_regprocedure('public.claim_stored_value_debit_receipt(uuid,text,text,bigint,text)') is null;
select has_function_privilege('authenticated', 'public.save_checkout_draft(text,timestamptz,jsonb,jsonb)', 'EXECUTE');
select has_function_privilege('anon', 'public.settle_checkout_draft(text,timestamptz)', 'EXECUTE');
select has_table_privilege('anon', 'public.stored_value_debit_receipts', 'SELECT');
select count(*) from public.stored_value_debit_receipts;
select pg_get_constraintdef(oid) from pg_constraint
 where conname = 'stored_value_debit_receipts_status';
SQL

export_catalog "$FINANCE" finance "$WORKDIR/finance-rollback.sql"
export_catalog "$BOOKING" booking "$WORKDIR/booking-rollback.sql"

cat > "$OUT/isolated-preimage-finance.sql" <<EOF
-- Isolated reconstruction of the finance functions, immutable ledger trigger,
-- and privileges that PR #84 replaces.
-- Preimage commit: $PREIMAGE
-- This file was generated from a local database loaded with that commit's SQL.
-- It is not a live catalog dump of bfzquejrtgqzzarhkiya.
-- Do not apply it to production until supabase/rollback/production-catalog-readonly.sql
-- returns the same function and trigger definitions.
-- Applying this file does not delete stored_value_ledger_entries.
EOF
cat "$WORKDIR/finance-rollback.sql" >> "$OUT/isolated-preimage-finance.sql"
cat >> "$OUT/isolated-preimage-finance.sql" <<'EOF'

-- Objects introduced by the release. Dropping them does not delete ledger rows.
DROP TRIGGER IF EXISTS trg_stored_value_ledger_current_line ON public.stored_value_ledger_entries;
DROP FUNCTION IF EXISTS public.stored_value_ledger_requires_current_line_membership();
DROP FUNCTION IF EXISTS public.customer_line_membership_is_current(uuid, uuid);
DROP FUNCTION IF EXISTS public.link_booking_source_from_verified_line(text, text, text, uuid);
DROP FUNCTION IF EXISTS public.decide_member_binding_request(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.current_line_subject_customers(uuid, text, text);
DROP FUNCTION IF EXISTS public.enqueue_member_binding_review(uuid, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.line_binding_customer_in_org(uuid, jsonb);
DROP FUNCTION IF EXISTS public.line_binding_resolved_customer_id(jsonb);
EOF

cat > "$OUT/isolated-preimage-booking.sql" <<EOF
-- Isolated reconstruction of the booking checkout functions and receipt-table
-- privileges that PR #84 replaces.
-- Preimage commit: $PREIMAGE
-- This file was generated from a local database loaded with that commit's SQL.
-- It is not a live catalog dump of knccefcxncglgpmvgqlp.
-- Do not apply it to production until supabase/rollback/production-catalog-readonly.sql
-- returns the same function definitions.
-- Applying this file does not delete stored_value_debit_receipts rows and does
-- not narrow the status check. A PENDING or FAILED receipt must remain valid.
EOF
cat "$WORKDIR/booking-rollback.sql" >> "$OUT/isolated-preimage-booking.sql"
cat >> "$OUT/isolated-preimage-booking.sql" <<'EOF'

DROP FUNCTION IF EXISTS public.claim_stored_value_debit_receipt(uuid, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.commit_stored_value_debit_receipt(uuid, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.abandon_stored_value_debit_receipt(uuid, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.save_checkout_draft(text, timestamptz, jsonb, jsonb, jsonb);
EOF

apply() {
  local db="$1"
  local file="$2"
  psql -d "$db" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$file"
}

apply "$FINANCE" "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql"
apply "$FINANCE" "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql"
apply "$FINANCE" "$ROOT/supabase/migrations/20261116143000_stored_value_line_checkout_gate.sql"
apply "$FINANCE" "$ROOT/supabase/migrations/20261116143000_stored_value_line_checkout_gate.sql"
apply "$BOOKING" "$ROOT/supabase/booking/20261115171000_checkout_stored_value_receipt.sql"

psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q <<'SQL'
insert into public.stored_value_debit_receipts (
  organization_id, checkout_app_id, source_customer_key, amount_minor, effect_key, status
) values (
  '11111111-1111-4111-8111-111111111111',
  'checkout-rollback-0001',
  'cust-hist-keep',
  100,
  'booking-checkout:checkout-rollback-0001',
  'PENDING'
);
SQL

apply "$BOOKING" "$ROOT/supabase/booking/20261115171000_checkout_stored_value_receipt.sql"

psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
begin
  if to_regprocedure('public.customer_line_membership_is_current(uuid,uuid)') is null then
    raise exception 'LINE membership function was not installed';
  end if;
  if to_regprocedure('public.settle_booking_source_checkout(text,text,text,text,bigint,text)') is null then
    raise exception 'checkout debit function is missing';
  end if;
  if to_regprocedure('public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)') is null then
    raise exception 'top-up function is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_stored_value_ledger_current_line' and not tgisinternal
  ) then
    raise exception 'current LINE ledger trigger was not installed';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_stored_value_ledger_immutable' and not tgisinternal
  ) then
    raise exception 'immutable ledger trigger disappeared';
  end if;
  if (select count(*) from public.stored_value_ledger_entries) <> 1 then
    raise exception 'ledger row count changed during migration';
  end if;
  begin
    delete from public.stored_value_ledger_entries where effect_key = 'seed:release-rollback';
    raise exception 'ledger delete was allowed';
  exception when others then
    if SQLERRM not like '%immutable%' then
      raise;
    end if;
  end;
end $$;
SQL

psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
begin
  if to_regprocedure('public.claim_stored_value_debit_receipt(uuid,text,text,bigint,text)') is null
     or to_regprocedure('public.commit_stored_value_debit_receipt(uuid,text,text,bigint,text)') is null
     or to_regprocedure('public.abandon_stored_value_debit_receipt(uuid,text,text,bigint,text)') is null then
    raise exception 'receipt functions were not installed';
  end if;
  if (select count(*) from public.stored_value_debit_receipts) <> 1 then
    raise exception 'receipt row count changed during re-run';
  end if;
  if (select status from public.stored_value_debit_receipts) <> 'PENDING' then
    raise exception 'receipt status changed during re-run';
  end if;
  if has_function_privilege('service_role', 'public.claim_stored_value_debit_receipt(uuid,text,text,bigint,text)', 'EXECUTE') is not true then
    raise exception 'service_role cannot execute the receipt claim';
  end if;
  if has_function_privilege('anon', 'public.claim_stored_value_debit_receipt(uuid,text,text,bigint,text)', 'EXECUTE') then
    raise exception 'anon can execute the receipt claim';
  end if;
end $$;
SQL

psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$OUT/isolated-preimage-finance.sql"
psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$OUT/isolated-preimage-booking.sql"

psql -d "$FINANCE" -v ON_ERROR_STOP=1 -X -q -A -t <<'SQL' > "$WORKDIR/finance-after.txt"
select md5(pg_get_functiondef('public.settle_booking_source_checkout(text,text,text,text,bigint,text)'::regprocedure));
select md5(pg_get_functiondef('public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)'::regprocedure));
select count(*) from public.stored_value_ledger_entries;
select count(*) from pg_trigger
 where tgname = 'trg_stored_value_ledger_immutable'
   and tgrelid = 'public.stored_value_ledger_entries'::regclass
   and not tgisinternal;
select count(*) from pg_trigger
 where tgname = 'trg_stored_value_ledger_current_line'
   and not tgisinternal;
select has_function_privilege('service_role', 'public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)', 'EXECUTE');
select has_function_privilege('anon', 'public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)', 'EXECUTE');
select has_function_privilege('authenticated', 'public.settle_booking_source_checkout(text,text,text,text,bigint,text)', 'EXECUTE');
select has_function_privilege('service_role', 'public.settle_booking_source_checkout(text,text,text,text,bigint,text)', 'EXECUTE');
SQL

psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q -A -t <<'SQL' > "$WORKDIR/booking-after.txt"
select md5(pg_get_functiondef('public.save_checkout_draft(text,timestamptz,jsonb,jsonb)'::regprocedure));
select md5(pg_get_functiondef('public.settle_checkout_draft(text,timestamptz)'::regprocedure));
select to_regprocedure('public.save_checkout_draft(text,timestamptz,jsonb,jsonb,jsonb)') is null;
select to_regprocedure('public.claim_stored_value_debit_receipt(uuid,text,text,bigint,text)') is null;
select has_function_privilege('authenticated', 'public.save_checkout_draft(text,timestamptz,jsonb,jsonb)', 'EXECUTE');
select has_function_privilege('anon', 'public.settle_checkout_draft(text,timestamptz)', 'EXECUTE');
select has_table_privilege('anon', 'public.stored_value_debit_receipts', 'SELECT');
select count(*) from public.stored_value_debit_receipts;
select status from public.stored_value_debit_receipts;
SQL

diff -u "$WORKDIR/finance-before.txt" "$WORKDIR/finance-after.txt"
before_fns="$(sed -n '1,7p' "$WORKDIR/booking-before.txt")"
after_fns="$(sed -n '1,7p' "$WORKDIR/booking-after.txt")"
if [[ "$before_fns" != "$after_fns" ]]; then
  echo "booking function restore did not match the preimage" >&2
  echo "BEFORE:" >&2
  cat "$WORKDIR/booking-before.txt" >&2
  echo "AFTER:" >&2
  cat "$WORKDIR/booking-after.txt" >&2
  exit 1
fi

psql -d "$BOOKING" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
begin
  if (select count(*) from public.stored_value_debit_receipts where status = 'PENDING') <> 1 then
    raise exception 'PENDING receipt did not survive rollback';
  end if;
  begin
    alter table public.stored_value_debit_receipts drop constraint stored_value_debit_receipts_status;
    alter table public.stored_value_debit_receipts
      add constraint stored_value_debit_receipts_status check (status = 'POSTED');
    raise exception 'narrow status check accepted a PENDING receipt';
  exception when check_violation then
    null;
  end;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'stored_value_debit_receipts_status')
       not like '%PENDING%' then
    raise exception 'status check was narrowed while a PENDING receipt existed';
  end if;
end $$;
SQL

echo "release rollback rehearsal passed"
