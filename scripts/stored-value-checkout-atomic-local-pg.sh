#!/usr/bin/env bash
# Isolated stored-value checkout proof.
# Unix socket only. Never connect to Preview or Production. Never debit a real wallet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_stored_value_checkout_local"
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

"${PSQL[@]}" -f "$ROOT/supabase/tests/stored-value-checkout-atomic.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115140000_customer_wallet_identity.sql"
"${PSQL[@]}" -f "$ROOT/supabase/beauty-os/stored_value_checkout_atomic.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/stored-value-checkout-atomic.local-cases.sql"

# Two different checkouts, one shared isolated wallet, released together.
"${PSQL[@]}" <<'SQL'
insert into public.customers (id, organization_id, status)
values ('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', 'ACTIVE');
insert into public.member_line_customer_links (organization_id, customer_id, verified_at)
values ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888888', now());
select tests.wallet('88888888-8888-4888-8888-888888888888', 1000);
select tests.open_sale(
  'sale-race-a',
  '88888888-8888-4888-8888-888888888888',
  'a1000000-0000-4000-8000-00000000000a',
  'b1000000-0000-4000-8000-00000000000a',
  800
);
select tests.open_sale(
  'sale-race-b',
  '88888888-8888-4888-8888-888888888888',
  'a1000000-0000-4000-8000-00000000000b',
  'b1000000-0000-4000-8000-00000000000b',
  800
);
select tests.pay('sale-race-a', 'STORED_VALUE', 800);
select tests.pay('sale-race-b', 'STORED_VALUE', 800);
insert into tests.gate (id, open) values (1, false);

insert into public.customers (id, organization_id, status)
values ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', 'ACTIVE');
insert into public.member_line_customer_links (organization_id, customer_id, verified_at)
values ('11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999991', now());
select tests.wallet('99999999-9999-4999-8999-999999999991', 1000);
select tests.open_sale(
  'sale-dup',
  '99999999-9999-4999-8999-999999999991',
  'a1000000-0000-4000-8000-00000000000d',
  'b1000000-0000-4000-8000-00000000000d',
  400
);
select tests.pay('sale-dup', 'STORED_VALUE', 400);
insert into tests.gate (id, open) values (2, false);

insert into public.customers (id, organization_id, status) values
  ('12121212-1212-4121-8121-121212121212', '11111111-1111-4111-8111-111111111111', 'ACTIVE'),
  ('13131313-1313-4131-8131-131313131313', '11111111-1111-4111-8111-111111111111', 'ACTIVE');
insert into public.member_line_customer_links (organization_id, customer_id, verified_at)
values ('11111111-1111-4111-8111-111111111111', '13131313-1313-4131-8131-131313131313', now());
select tests.wallet('13131313-1313-4131-8131-131313131313', 2100);
insert into public.customer_wallet_identities (
  organization_id, booking_customer_id, wallet_customer_id, reason, confirmed_by_staff_id
) values (
  '11111111-1111-4111-8111-111111111111',
  '12121212-1212-4121-8121-121212121212',
  '13131313-1313-4131-8131-131313131313',
  '隔離測試同時扣款',
  'staff-test-1'
);
select tests.open_sale(
  'sale-link-a',
  '12121212-1212-4121-8121-121212121212',
  'a1000000-0000-4000-8000-00000000001a',
  'b1000000-0000-4000-8000-00000000001a',
  1500
);
select tests.open_sale(
  'sale-link-b',
  '12121212-1212-4121-8121-121212121212',
  'a1000000-0000-4000-8000-00000000001b',
  'b1000000-0000-4000-8000-00000000001b',
  1500
);
select tests.pay('sale-link-a', 'STORED_VALUE', 1500);
select tests.pay('sale-link-b', 'STORED_VALUE', 1500);
insert into tests.gate (id, open) values (3, false);
SQL

run_pair() {
  local gate_id="$1"
  local app_a="$2"
  local app_b="$3"
  local out_a="$4"
  local out_b="$5"
  local when="2026-11-15 00:00:00+00"
  local sql_a="select set_config('tests.uid', '99999999-9999-4999-8999-999999999999', false); do \$\$ declare i int := 0; begin loop exit when exists (select 1 from tests.gate where id = ${gate_id} and open); perform pg_sleep(0.02); i := i + 1; if i > 400 then raise exception 'gate timeout'; end if; end loop; perform public.settle_checkout_draft('${app_a}', timestamptz '${when}'); end \$\$;"
  local sql_b="${sql_a//${app_a}/${app_b}}"
  psql -d "$DB" -v ON_ERROR_STOP=1 -X -c "$sql_a" >"$out_a" 2>&1 &
  local pid_a=$!
  psql -d "$DB" -v ON_ERROR_STOP=1 -X -c "$sql_b" >"$out_b" 2>&1 &
  local pid_b=$!
  sleep 0.3
  "${PSQL[@]}" -c "update tests.gate set open = true where id = ${gate_id};"
  local status_a=0
  local status_b=0
  wait "$pid_a" || status_a=$?
  wait "$pid_b" || status_b=$?
  echo "$status_a $status_b"
}

RACE_STATUS="$(run_pair 1 sale-race-a sale-race-b /tmp/sv-race-a.txt /tmp/sv-race-b.txt)"
echo "concurrent different checkouts exit: $RACE_STATUS"
echo "--- race A ---"
cat /tmp/sv-race-a.txt
echo "--- race B ---"
cat /tmp/sv-race-b.txt

LINK_STATUS="$(run_pair 3 sale-link-a sale-link-b /tmp/sv-link-a.txt /tmp/sv-link-b.txt)"
echo "concurrent linked checkouts exit: $LINK_STATUS"
echo "--- link A ---"
cat /tmp/sv-link-a.txt
echo "--- link B ---"
cat /tmp/sv-link-b.txt

DUP_STATUS="$(run_pair 2 sale-dup sale-dup /tmp/sv-dup-a.txt /tmp/sv-dup-b.txt)"
echo "concurrent same checkout exit: $DUP_STATUS"
echo "--- dup A ---"
cat /tmp/sv-dup-a.txt
echo "--- dup B ---"
cat /tmp/sv-dup-b.txt

"${PSQL[@]}" <<'SQL'
do $$
declare
  v_race uuid := '88888888-8888-4888-8888-888888888888';
  v_dup uuid := '99999999-9999-4999-8999-999999999991';
  v_success int;
  v_fail int;
begin
  if tests.balance(v_race) <> 200 or tests.member_payments(v_race) <> 1 then
    raise exception 'concurrent checkouts overdrew or double-posted, balance % payments %',
      tests.balance(v_race), tests.member_payments(v_race);
  end if;
  select count(*) into v_success
  from public.transactions t
  join public.checkout_drafts d on d.id = t.checkout_draft_id
  where d.app_id in ('sale-race-a', 'sale-race-b');
  select count(*) into v_fail
  from public.checkout_drafts
  where app_id in ('sale-race-a', 'sale-race-b') and status = 'OPEN';
  if v_success <> 1 or v_fail <> 1 then
    raise exception 'concurrent checkouts settled % and left % open', v_success, v_fail;
  end if;

  if tests.balance(v_dup) <> 600 or tests.member_payments(v_dup) <> 1 then
    raise exception 'duplicate concurrent settle posted more than once, balance %', tests.balance(v_dup);
  end if;
  if (
    select count(*) from public.transactions t
    join public.checkout_drafts d on d.id = t.checkout_draft_id
    where d.app_id = 'sale-dup'
  ) <> 1 then
    raise exception 'duplicate concurrent settle created more than one transaction';
  end if;

  if tests.balance('13131313-1313-4131-8131-131313131313'::uuid) <> 600
     or tests.member_payments('13131313-1313-4131-8131-131313131313'::uuid) <> 1 then
    raise exception 'linked concurrent checkouts overdrew the shared wallet';
  end if;
  if (
    select count(*) from public.checkout_drafts
    where app_id in ('sale-link-a', 'sale-link-b') and status = 'OPEN'
  ) <> 1 then
    raise exception 'linked concurrent checkouts did not leave one draft open';
  end if;
end $$;
SQL

echo "stored-value checkout atomic cases passed"
