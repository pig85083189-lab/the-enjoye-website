#!/usr/bin/env bash
# Isolated LINE booking-source proof.
# Unix socket only. Never connect to Preview or Production. Never debit a real wallet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_booking_source_local"
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
  dropdb --if-exists "${PROD_DB:-}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

dropdb --if-exists "$DB"
createdb "$DB"

"${PSQL[@]}" -f "$ROOT/supabase/tests/stored-value-checkout-atomic.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115140000_customer_wallet_identity.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115170000_booking_source_customer_links.sql"
"${PSQL[@]}" <<'SQL'
insert into public.customers (id, organization_id, status, app_id)
values ('faafffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-legacy-keep');
insert into public.booking_source_customer_links (
  organization_id, source_customer_key, finance_booking_customer_id,
  evidence_kind, reason, confirmed_by_staff_id, confirmed_by_auth_user_id
) values (
  '11111111-1111-4111-8111-111111111111', 'src-legacy-keep', 'faafffff-ffff-4fff-8fff-ffffffffffff',
  'CUSTOMER_PRESENT', '既有主管對應必須保留', 'staff-owner-test', '99999999-9999-4999-8999-999999999999'
);
insert into public.member_line_customer_links (organization_id, customer_id, verified_at)
values ('11111111-1111-4111-8111-111111111111', 'faafffff-ffff-4fff-8fff-ffffffffffff', timestamptz '2026-11-01 00:00:00+00');
create table public.member_binding_requests (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  note text,
  created_at timestamptz not null default now()
);
insert into public.member_binding_requests (id, organization_id, note)
values ('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'keep-existing-review');
grant select on public.member_binding_requests to public;
SQL
psql -d "$DB" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql"
psql -d "$DB" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql"
"${PSQL[@]}" <<'SQL'
do $$
begin
  if (select count(*) from public.booking_source_customer_links where source_customer_key = 'src-legacy-keep' and evidence_kind = 'CUSTOMER_PRESENT' and link_origin = 'MANAGER_REVIEW') <> 1 then
    raise exception 'existing managerial link was rewritten';
  end if;
  if (select verified_at from public.member_line_customer_links where customer_id = 'faafffff-ffff-4fff-8fff-ffffffffffff') <> timestamptz '2026-11-01 00:00:00+00'
     or (select line_subject_hash from public.member_line_customer_links where customer_id = 'faafffff-ffff-4fff-8fff-ffffffffffff') is not null then
    raise exception 'existing member link was rewritten';
  end if;
  if (select note from public.member_binding_requests where id = 'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 'keep-existing-review' then
    raise exception 'existing binding request was rewritten';
  end if;
  if (select relrowsecurity from pg_class where oid = 'public.member_binding_requests'::regclass) then
    raise exception 'pre-existing binding requests had row level security forced on';
  end if;
  if not exists (
    select 1
    from pg_class class_row
    cross join lateral aclexplode(class_row.relacl) acl
    where class_row.oid = 'public.member_binding_requests'::regclass
      and acl.grantee = 0
      and acl.privilege_type = 'SELECT'
  ) then
    raise exception 'pre-existing binding request grant was removed';
  end if;
end $$;
SQL
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-verified-booking-source.local-cases.sql"

"${PSQL[@]}" <<'SQL'
insert into public.customers (id, organization_id, status, app_id)
values ('f99fffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-line-race');
insert into public.line_customer_bindings (
  organization_id, customer_uuid, status, verified, confirmed_at, bound_at, line_user_id_hash
) values (
  'org-stored-value-test', 'f99fffff-ffff-4fff-8fff-ffffffffffff', 'active', true, now(), now(), repeat('98', 32)
);
select set_config('tests.uid', '99999999-9999-4999-8999-999999999999', false);
SQL

RACE="select set_config('tests.uid', '99999999-9999-4999-8999-999999999999', false); select public.link_booking_source_from_verified_line('org-stored-value-test', 'src-line-race', repeat('98', 32), '99999999-9999-4999-8999-999999999999');"
psql -d "$DB" -v ON_ERROR_STOP=1 -X -c "$RACE" >/tmp/line-link-race-a.txt 2>&1 &
pid_a=$!
psql -d "$DB" -v ON_ERROR_STOP=1 -X -c "$RACE" >/tmp/line-link-race-b.txt 2>&1 &
pid_b=$!
status_a=0
status_b=0
wait "$pid_a" || status_a=$?
wait "$pid_b" || status_b=$?
echo "concurrent LINE links exit: $status_a $status_b"

"${PSQL[@]}" <<'SQL'
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.booking_source_customer_links
  where source_customer_key = 'src-line-race' and status = 'ACTIVE';
  if v_count <> 1 then
    raise exception 'concurrent LINE login created % links', v_count;
  end if;
end $$;
SQL

echo "line verified booking source cases passed"

# Production-shaped database: member_binding_requests is absent, both member-line
# unique keys and RLS already exist, and a historical ledger row must survive.
PROD_DB="beauty_os_line_booking_source_prodshape"
dropdb --if-exists "$PROD_DB"
createdb "$PROD_DB"
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/tests/stored-value-checkout-atomic.local-stub.sql"
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/migrations/20261115140000_customer_wallet_identity.sql"
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/migrations/20261115170000_booking_source_customer_links.sql"
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
alter table public.member_line_customer_links add column if not exists line_subject_hash text;
alter table public.member_line_customer_links
  add constraint member_line_customer_links_org_subject unique (organization_id, line_subject_hash);
alter table public.member_line_customer_links enable row level security;
insert into public.customers (id, organization_id, status, app_id)
values ('faafffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-legacy-keep');
insert into public.booking_source_customer_links (
  organization_id, source_customer_key, finance_booking_customer_id,
  evidence_kind, reason, confirmed_by_staff_id, confirmed_by_auth_user_id
) values (
  '11111111-1111-4111-8111-111111111111', 'src-legacy-keep', 'faafffff-ffff-4fff-8fff-ffffffffffff',
  'CUSTOMER_PRESENT', '既有主管對應必須保留', 'staff-owner-test', '99999999-9999-4999-8999-999999999999'
);
insert into public.member_line_customer_links (organization_id, customer_id, verified_at, line_subject_hash)
values (
  '11111111-1111-4111-8111-111111111111', 'faafffff-ffff-4fff-8fff-ffffffffffff',
  timestamptz '2026-11-01 00:00:00+00', repeat('11', 32)
);
insert into public.stored_value_accounts (id, organization_id, customer_id, currency, status)
values (
  'f0afffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111',
  'faafffff-ffff-4fff-8fff-ffffffffffff', 'TWD', 'ACTIVE'
);
insert into public.stored_value_ledger_entries (
  organization_id, account_id, customer_id, type, amount_delta_minor, effect_key, created_by_staff_id
) values (
  '11111111-1111-4111-8111-111111111111', 'f0afffff-ffff-4fff-8fff-ffffffffffff',
  'faafffff-ffff-4fff-8fff-ffffffffffff', 'TOP_UP', 2100, 'legacy-ledger-keep', 'staff-owner-test'
);
alter table public.booking_source_customer_links drop constraint booking_source_customer_links_evidence;
insert into public.customers (id, organization_id, status, app_id)
values ('faacffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-unknown-evidence');
insert into public.booking_source_customer_links (
  organization_id, source_customer_key, finance_booking_customer_id,
  evidence_kind, reason, confirmed_by_staff_id, confirmed_by_auth_user_id
) values (
  '11111111-1111-4111-8111-111111111111', 'src-unknown-evidence', 'faacffff-ffff-4fff-8fff-ffffffffffff',
  'UNKNOWN_KIND', '未知證據必須拒絕', 'staff-owner-test', '99999999-9999-4999-8999-999999999999'
);
SQL

set +e
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql" >/tmp/line-prodshape-refuse.txt 2>&1
refuse_status=$?
set -e
if [[ "$refuse_status" -eq 0 ]]; then
  echo "production-shaped migration accepted an unrecognized evidence kind" >&2
  exit 1
fi
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'booking_source_customer_links' and column_name = 'link_origin'
  ) then
    raise exception 'refused migration still added link_origin';
  end if;
  if to_regclass('public.member_binding_requests') is not null then
    raise exception 'refused migration still created member_binding_requests';
  end if;
  if (select amount_delta_minor from public.stored_value_ledger_entries where effect_key = 'legacy-ledger-keep') <> 2100 then
    raise exception 'refused migration changed the historical ledger';
  end if;
end $$;
delete from public.booking_source_customer_links where evidence_kind = 'UNKNOWN_KIND';
alter table public.booking_source_customer_links
  add constraint booking_source_customer_links_evidence check (
    evidence_kind in ('CUSTOMER_PRESENT', 'TRUSTED_MEMBER_RECORD')
  );
SQL

psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql"
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql"
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
begin
  if (select count(*) from public.booking_source_customer_links
      where source_customer_key = 'src-legacy-keep'
        and finance_booking_customer_id = 'faafffff-ffff-4fff-8fff-ffffffffffff'
        and evidence_kind = 'CUSTOMER_PRESENT'
        and confirmed_by_staff_id = 'staff-owner-test'
        and link_origin = 'MANAGER_REVIEW') <> 1 then
    raise exception 'existing booking source link was rewritten';
  end if;
  if (select relrowsecurity from pg_class where oid = 'public.booking_source_customer_links'::regclass) is not true
     or (select relrowsecurity from pg_class where oid = 'public.member_line_customer_links'::regclass) is not true
     or (select relrowsecurity from pg_class where oid = 'public.member_binding_requests'::regclass) is not true then
    raise exception 'row level security was not preserved or not enabled on the new review table';
  end if;
  if (select count(*) from pg_constraint
      where conrelid = 'public.member_line_customer_links'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%line_subject_hash%') <> 1
     or (select count(*) from pg_constraint
      where conrelid = 'public.member_line_customer_links'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%customer_id%') <> 1 then
    raise exception 'member line unique keys were not preserved';
  end if;
  if (select count(*) from public.stored_value_ledger_entries where effect_key = 'legacy-ledger-keep' and amount_delta_minor = 2100) <> 1 then
    raise exception 'historical stored value ledger changed';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'member_binding_requests_status')
     not like '%PENDING%'
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'member_binding_requests_status')
     not like '%APPROVED%'
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'member_binding_requests_status')
     not like '%REJECTED%' then
    raise exception 'new review status check is missing';
  end if;
end $$;

insert into public.customers (id, organization_id, status, app_id) values
  ('fab0ffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-unbound'),
  ('fab1ffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-pending-review'),
  ('fab2ffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-revoked-stale'),
  ('fab3ffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-rebind-write');
insert into public.stored_value_accounts (organization_id, customer_id, currency, status) values
  ('11111111-1111-4111-8111-111111111111', 'fab0ffff-ffff-4fff-8fff-ffffffffffff', 'TWD', 'ACTIVE'),
  ('11111111-1111-4111-8111-111111111111', 'fab1ffff-ffff-4fff-8fff-ffffffffffff', 'TWD', 'ACTIVE'),
  ('11111111-1111-4111-8111-111111111111', 'fab2ffff-ffff-4fff-8fff-ffffffffffff', 'TWD', 'ACTIVE'),
  ('11111111-1111-4111-8111-111111111111', 'fab3ffff-ffff-4fff-8fff-ffffffffffff', 'TWD', 'ACTIVE');
insert into public.member_binding_requests (
  organization_id, line_subject_hash, source_customer_key, reason_code, requested_by_auth_user_id
) values (
  '11111111-1111-4111-8111-111111111111', repeat('22', 32), 'src-pending-review',
  'NO_TRUSTED_ASSOCIATION', '99999999-9999-4999-8999-999999999999'
);
insert into public.line_customer_bindings (
  organization_id, customer_uuid, status, verified, unbound_at, line_user_id_hash
) values (
  'org-stored-value-test', 'fab2ffff-ffff-4fff-8fff-ffffffffffff', 'unbound', false,
  timestamptz '2026-11-15 00:00:00+00', repeat('33', 32)
);
insert into public.member_line_customer_links (organization_id, customer_id, verified_at, line_subject_hash)
values (
  '11111111-1111-4111-8111-111111111111', 'fab2ffff-ffff-4fff-8fff-ffffffffffff',
  timestamptz '2026-11-16 00:00:00+00', repeat('33', 32)
);
insert into public.line_customer_bindings (
  organization_id, customer_uuid, status, verified, unbound_at, line_user_id_hash
) values (
  'org-stored-value-test', 'fab3ffff-ffff-4fff-8fff-ffffffffffff', 'unbound', false,
  timestamptz '2026-11-15 00:00:00+00', repeat('44', 32)
);
insert into public.member_line_customer_links (organization_id, customer_id, verified_at, line_subject_hash)
values (
  '11111111-1111-4111-8111-111111111111', 'fab3ffff-ffff-4fff-8fff-ffffffffffff',
  timestamptz '2026-11-14 00:00:00+00', repeat('44', 32)
);
insert into public.line_customer_bindings (
  organization_id, customer_uuid, status, verified, confirmed_at, bound_at, line_user_id_hash
) values (
  'org-stored-value-test', 'fab3ffff-ffff-4fff-8fff-ffffffffffff', 'active', true,
  timestamptz '2026-11-16 00:00:00+00', timestamptz '2026-11-16 00:00:00+00', repeat('55', 32)
);
SQL

insert_ledger() {
  local customer="$1"
  local effect="$2"
  psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q -c "insert into public.stored_value_ledger_entries (organization_id, account_id, customer_id, type, amount_delta_minor, effect_key, created_by_staff_id) select '11111111-1111-4111-8111-111111111111', id, '$customer', 'TOP_UP', 100, '$effect', 'staff-owner-test' from public.stored_value_accounts where customer_id = '$customer';"
}

set +e
insert_ledger "fab0ffff-ffff-4fff-8fff-ffffffffffff" "write-unbound" >/tmp/line-write-unbound.txt 2>&1
unbound_status=$?
insert_ledger "fab1ffff-ffff-4fff-8fff-ffffffffffff" "write-pending" >/tmp/line-write-pending.txt 2>&1
pending_status=$?
insert_ledger "fab2ffff-ffff-4fff-8fff-ffffffffffff" "write-stale" >/tmp/line-write-stale.txt 2>&1
stale_status=$?
set -e
insert_ledger "fab3ffff-ffff-4fff-8fff-ffffffffffff" "write-rebind"
if [[ "$unbound_status" -eq 0 || "$pending_status" -eq 0 || "$stale_status" -eq 0 ]]; then
  echo "stored value write accepted a customer without a current LINE binding" >&2
  exit 1
fi
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
begin
  if (select count(*) from public.stored_value_ledger_entries where effect_key in ('write-unbound', 'write-pending', 'write-stale')) <> 0 then
    raise exception 'rejected stored value write left a ledger row';
  end if;
  if (select count(*) from public.stored_value_ledger_entries where effect_key = 'write-rebind' and amount_delta_minor = 100) <> 1 then
    raise exception 'current rebind could not write stored value';
  end if;
  if (select amount_delta_minor from public.stored_value_ledger_entries where effect_key = 'legacy-ledger-keep') <> 2100 then
    raise exception 'new writes changed the historical ledger';
  end if;
end $$;
SQL
dropdb --if-exists "$PROD_DB"
echo "production-shaped LINE migration cases passed"
