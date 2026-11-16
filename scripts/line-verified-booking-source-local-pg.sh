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
  dropdb --if-exists "${TYPE_DB:-}" >/dev/null 2>&1 || true
  dropdb --if-exists "${COLUMN_DB:-}" >/dev/null 2>&1 || true
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
create policy booking_source_keep_select on public.booking_source_customer_links for select using (true);
create policy member_line_keep_select on public.member_line_customer_links for select using (true);
create policy ledger_keep_select on public.stored_value_ledger_entries for select using (true);
create table tests.column_types as
select table_name, column_name, udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('organizations', 'booking_source_customer_links', 'line_customer_bindings', 'stored_value_ledger_entries');
create table tests.ledger_checks as
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.stored_value_ledger_entries'::regclass;
create table tests.policy_snapshot as
select polrelid::regclass::text as table_name, polname, pg_get_expr(polqual, polrelid) as qual
from pg_policy
where polname in ('booking_source_keep_select', 'member_line_keep_select', 'ledger_keep_select');
alter table public.stored_value_ledger_entries enable row level security;
create policy stored_value_ledger_select_org on public.stored_value_ledger_entries
  for select to authenticated
  using (public.user_has_org_membership(organization_id));
create policy stored_value_ledger_insert_org on public.stored_value_ledger_entries
  for insert to authenticated
  with check (public.user_has_org_membership(organization_id));
create unique index if not exists idx_customers_org_app_id
  on public.customers (organization_id, app_id)
  where app_id is not null;
create table tests.fk_snapshot as
select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'f'
  and conrelid in (
    'public.customers'::regclass,
    'public.stored_value_ledger_entries'::regclass,
    'public.booking_source_customer_links'::regclass
  );
create table tests.unique_snapshot as
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'booking_source_customer_links_active_key',
    'booking_source_customer_links_active_finance',
    'idx_stored_value_ledger_org_effect_key',
    'idx_customers_org_app_id'
  );
create table tests.trigger_snapshot as
select tgname, pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'public.stored_value_ledger_entries'::regclass
  and not tgisinternal;
create table tests.named_policy_snapshot as
select polname,
       pg_get_expr(polqual, polrelid) as qual,
       pg_get_expr(polwithcheck, polrelid) as with_check
from pg_policy
where polname in (
  'booking_source_customer_links_select_org',
  'stored_value_ledger_select_org',
  'stored_value_ledger_insert_org'
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
  if exists (
    select 1
    from tests.column_types previous
    join information_schema.columns current
      on current.table_schema = 'public'
     and current.table_name = previous.table_name
     and current.column_name = previous.column_name
    where current.udt_name is distinct from previous.udt_name
  ) then
    raise exception 'migration changed an existing column type';
  end if;
  if (select udt_name from information_schema.columns
      where table_name = 'booking_source_customer_links' and column_name = 'link_origin') <> 'text'
     or (select udt_name from information_schema.columns
      where table_name = 'line_customer_bindings' and column_name = 'organization_id') <> 'text'
     or (select udt_name from information_schema.columns
      where table_name = 'organizations' and column_name = 'id') <> 'uuid'
     or (select udt_name from information_schema.columns
      where table_name = 'organizations' and column_name = 'app_id') <> 'text' then
    raise exception 'confirmed identity column types were not preserved';
  end if;
  if exists (
    select 1
    from tests.ledger_checks previous
    join pg_constraint current on current.conname = previous.conname
    where current.conrelid = 'public.stored_value_ledger_entries'::regclass
      and pg_get_constraintdef(current.oid) is distinct from previous.definition
  ) or (select count(*) from tests.ledger_checks) <> (
    select count(*) from pg_constraint where conrelid = 'public.stored_value_ledger_entries'::regclass
  ) then
    raise exception 'stored value ledger constraints were rewritten';
  end if;
  if (select count(*) from tests.policy_snapshot previous
      join pg_policy current on current.polname = previous.polname
      where pg_get_expr(current.polqual, current.polrelid) is not distinct from previous.qual) <> 3 then
    raise exception 'existing row level security policies were rewritten';
  end if;
  if (select count(*) from tests.named_policy_snapshot) <> 3
     or exists (
       select 1
       from tests.named_policy_snapshot previous
       join pg_policy current on current.polname = previous.polname
       where pg_get_expr(current.polqual, current.polrelid) is distinct from previous.qual
          or pg_get_expr(current.polwithcheck, current.polrelid) is distinct from previous.with_check
     ) then
    raise exception 'production row level security policies were rewritten';
  end if;
  if (select count(*) from tests.fk_snapshot) <> (
       select count(*)
       from pg_constraint
       where contype = 'f'
         and conrelid in (
           'public.customers'::regclass,
           'public.stored_value_ledger_entries'::regclass,
           'public.booking_source_customer_links'::regclass
         )
     )
     or exists (
       select 1
       from tests.fk_snapshot previous
       join pg_constraint current on current.conname = previous.conname
       where pg_get_constraintdef(current.oid) is distinct from previous.definition
     ) then
    raise exception 'finance foreign keys were rewritten';
  end if;
  if (select count(*) from tests.unique_snapshot) <> 4
     or exists (
       select 1
       from tests.unique_snapshot previous
       join pg_indexes current on current.indexname = previous.indexname
       where current.indexdef is distinct from previous.indexdef
     ) then
    raise exception 'finance unique indexes were rewritten';
  end if;
  if (select definition from tests.trigger_snapshot where tgname = 'trg_stored_value_ledger_immutable')
     is distinct from (
       select pg_get_triggerdef(oid)
       from pg_trigger
       where tgrelid = 'public.stored_value_ledger_entries'::regclass
         and tgname = 'trg_stored_value_ledger_immutable'
     )
     or (select pg_get_triggerdef(oid) from pg_trigger
         where tgname = 'trg_stored_value_ledger_current_line')
        not ilike '%before insert%' then
    raise exception 'stored value triggers conflict or the immutable trigger changed';
  end if;
end $$;

alter table public.line_customer_bindings add column if not exists customer_id text;
insert into public.customers (id, organization_id, status, app_id)
values ('fab4ffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-text-id');
insert into public.line_customer_bindings (
  organization_id, customer_uuid, customer_id, status, verified, confirmed_at, bound_at, line_user_id_hash
) values (
  'org-stored-value-test', null, 'fab4ffff-ffff-4fff-8fff-ffffffffffff', 'active', true, now(), now(), repeat('66', 32)
), (
  '11111111-1111-4111-8111-111111111111', null, 'fab4ffff-ffff-4fff-8fff-ffffffffffff', 'active', true, now(), now(), repeat('77', 32)
), (
  'org-stored-value-test', null, 'not-a-uuid', 'active', true, now(), now(), repeat('88', 32)
);
SQL
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
begin
  if public.line_binding_resolved_customer_id('{"customer_id":"not-a-uuid"}'::jsonb) is not null
     or public.line_binding_resolved_customer_id('{"customer_id":"fab4ffff-ffff-4fff-8fff-ffffffffffff"}'::jsonb)
        is distinct from 'fab4ffff-ffff-4fff-8fff-ffffffffffff'::uuid then
    raise exception 'text customer id conversion was not safe';
  end if;
  if public.customer_line_membership_is_current(
       '11111111-1111-4111-8111-111111111111', 'fab4ffff-ffff-4fff-8fff-ffffffffffff') is not true then
    raise exception 'uuid-shaped text customer_id was not accepted';
  end if;
  if exists (
    select 1 from public.current_line_subject_customers(
      '11111111-1111-4111-8111-111111111111', 'org-stored-value-test', repeat('77', 32)
    )
  ) or exists (
    select 1 from public.current_line_subject_customers(
      '11111111-1111-4111-8111-111111111111', 'org-stored-value-test', repeat('88', 32)
    )
  ) then
    raise exception 'uuid text organization_id or invalid customer_id was accepted';
  end if;
end $$;
SQL

psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
insert into public.organizations (id, app_id)
values ('22222222-2222-4222-8222-222222222222', 'org-other')
on conflict (id) do nothing;
drop index if exists public.idx_customers_org_app_id;
insert into public.customers (id, organization_id, status, app_id) values
  ('fab5ffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-prod-shape-a'),
  ('fab6ffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-prod-shape-b'),
  ('fab7ffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-prod-shape-c'),
  ('fab8ffff-ffff-4fff-8fff-ffffffffffff', '22222222-2222-4222-8222-222222222222', 'ACTIVE', 'cust-other-org'),
  ('fab9ffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-ambiguous'),
  ('fabaffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-ambiguous');
insert into public.line_customer_bindings (
  organization_id, customer_uuid, customer_id, status, verified, confirmed_at, bound_at, line_user_id_hash
) values (
  'org-stored-value-test', 'fab5ffff-ffff-4fff-8fff-ffffffffffff', 'cust-not-uuid-a',
  'active', true, now(), now(), repeat('91', 32)
);
insert into public.line_customer_bindings (
  organization_id, customer_uuid, customer_id, status, verified, confirmed_at, bound_at, line_user_id_hash
) values (
  'org-stored-value-test', null, 'cust-prod-shape-b',
  'active', true, now(), now(), repeat('92', 32)
);
insert into public.line_customer_bindings (
  organization_id, customer_uuid, customer_id, status, verified, unbound_at, line_user_id_hash
) values (
  'org-stored-value-test', null, 'cust-prod-shape-c',
  'unbound', false, timestamptz '2026-11-15 00:00:00+00', repeat('93', 32)
);
insert into public.member_line_customer_links (organization_id, customer_id, verified_at, line_subject_hash)
values (
  '11111111-1111-4111-8111-111111111111', 'fab7ffff-ffff-4fff-8fff-ffffffffffff',
  timestamptz '2026-11-16 00:00:00+00', repeat('93', 32)
);
insert into public.line_customer_bindings (
  organization_id, customer_uuid, customer_id, status, verified, confirmed_at, bound_at, line_user_id_hash
) values (
  'org-stored-value-test', 'fab8ffff-ffff-4fff-8fff-ffffffffffff', 'cust-prod-shape-a',
  'active', true, now(), now(), repeat('94', 32)
);
insert into public.line_customer_bindings (
  organization_id, customer_uuid, customer_id, status, verified, confirmed_at, bound_at, line_user_id_hash
) values (
  'org-stored-value-test', null, 'cust-ambiguous',
  'active', true, now(), now(), repeat('95', 32)
);
SQL

psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
declare
  v_verified timestamptz;
  v_result jsonb;
begin
  if public.line_binding_customer_in_org(
       '11111111-1111-4111-8111-111111111111',
       '{"customer_uuid":"fab5ffff-ffff-4fff-8fff-ffffffffffff","customer_id":"cust-not-uuid-a"}'::jsonb
     ) is distinct from 'fab5ffff-ffff-4fff-8fff-ffffffffffff'::uuid
     or public.line_binding_customer_in_org(
       '11111111-1111-4111-8111-111111111111',
       '{"customer_id":"cust-prod-shape-b"}'::jsonb
     ) is distinct from 'fab6ffff-ffff-4fff-8fff-ffffffffffff'::uuid
     or public.line_binding_customer_in_org(
       '11111111-1111-4111-8111-111111111111',
       '{"customer_uuid":"fab8ffff-ffff-4fff-8fff-ffffffffffff","customer_id":"cust-prod-shape-a"}'::jsonb
     ) is not null
     or public.line_binding_customer_in_org(
       '11111111-1111-4111-8111-111111111111',
       '{"customer_id":"cust-ambiguous"}'::jsonb
     ) is not null then
    raise exception 'production-shaped customer resolution was not limited to the same organization';
  end if;
  if public.customer_line_membership_is_current(
       '11111111-1111-4111-8111-111111111111', 'fab7ffff-ffff-4fff-8fff-ffffffffffff') is not false then
    raise exception 'newer member verified_at revived an unbound text customer id';
  end if;
  select verified_at into v_verified
  from public.member_line_customer_links
  where customer_id = 'fab7ffff-ffff-4fff-8fff-ffffffffffff';
  perform set_config('tests.uid', '99999999-9999-4999-8999-999999999999', false);
  v_result := public.link_booking_source_from_verified_line(
    'org-stored-value-test', 'src-prod-shape-c', repeat('93', 32), '99999999-9999-4999-8999-999999999999'
  );
  if v_result->>'reasonCode' <> 'LINE_REVOKED'
     or (select verified_at from public.member_line_customer_links where customer_id = 'fab7ffff-ffff-4fff-8fff-ffffffffffff')
        is distinct from v_verified then
    raise exception 'revoked text binding was overwritten: %', v_result;
  end if;
  v_result := public.link_booking_source_from_verified_line(
    'org-stored-value-test', 'src-prod-shape-b', repeat('92', 32), '99999999-9999-4999-8999-999999999999'
  );
  if v_result->>'outcome' <> 'linked' then
    raise exception 'unique app id binding did not link: %', v_result;
  end if;
end $$;
SQL

psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q -c "alter role service_role bypassrls; grant select on public.stored_value_accounts to service_role; grant insert on public.stored_value_ledger_entries to service_role;"
set +e
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL' >/tmp/line-service-role-unbound.txt 2>&1
do $$
begin
  set local role service_role;
  insert into public.stored_value_ledger_entries (
    organization_id, account_id, customer_id, type, amount_delta_minor, effect_key, created_by_staff_id
  )
  select '11111111-1111-4111-8111-111111111111', id, 'fab0ffff-ffff-4fff-8fff-ffffffffffff',
         'TOP_UP', 100, 'service-role-unbound', 'staff-owner-test'
  from public.stored_value_accounts
  where customer_id = 'fab0ffff-ffff-4fff-8fff-ffffffffffff';
end $$;
SQL
service_unbound_status=$?
set -e
if [[ "$service_unbound_status" -eq 0 ]] || ! grep -q '必須先完成 LINE 會員綁定' /tmp/line-service-role-unbound.txt; then
  echo "service role ledger insert was not gated by the current LINE binding" >&2
  cat /tmp/line-service-role-unbound.txt >&2
  exit 1
fi
psql -d "$PROD_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
begin
  set local role service_role;
  insert into public.stored_value_ledger_entries (
    organization_id, account_id, customer_id, type, amount_delta_minor, effect_key, created_by_staff_id
  )
  select '11111111-1111-4111-8111-111111111111', id, 'fab3ffff-ffff-4fff-8fff-ffffffffffff',
         'TOP_UP', 100, 'service-role-current', 'staff-owner-test'
  from public.stored_value_accounts
  where customer_id = 'fab3ffff-ffff-4fff-8fff-ffffffffffff';
end $$;
do $$
begin
  if (select count(*) from public.stored_value_ledger_entries where effect_key = 'service-role-current') <> 1 then
    raise exception 'service role could not write a current LINE binding';
  end if;
  begin
    update public.stored_value_ledger_entries
       set amount_delta_minor = 1
     where effect_key = 'legacy-ledger-keep';
    raise exception 'immutable ledger accepted an update';
  exception
    when others then
      if sqlerrm <> 'ledger is immutable' then
        raise exception 'immutable trigger did not reject the update: %', sqlerrm;
      end if;
  end;
  begin
    delete from public.stored_value_ledger_entries where effect_key = 'legacy-ledger-keep';
    raise exception 'immutable ledger accepted a delete';
  exception
    when others then
      if sqlerrm <> 'ledger is immutable' then
        raise exception 'immutable trigger did not reject the delete: %', sqlerrm;
      end if;
  end;
  if (select amount_delta_minor from public.stored_value_ledger_entries where effect_key = 'legacy-ledger-keep') <> 2100 then
    raise exception 'trigger checks changed the historical ledger';
  end if;
end $$;
SQL

TYPE_DB="beauty_os_line_binding_type_refuse"
dropdb --if-exists "$TYPE_DB"
createdb "$TYPE_DB"
psql -d "$TYPE_DB" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/tests/stored-value-checkout-atomic.local-stub.sql" >/dev/null
psql -d "$TYPE_DB" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/migrations/20261115140000_customer_wallet_identity.sql" >/dev/null
psql -d "$TYPE_DB" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/migrations/20261115170000_booking_source_customer_links.sql" >/dev/null
psql -d "$TYPE_DB" -v ON_ERROR_STOP=1 -X -q -c "alter table public.line_customer_bindings alter column organization_id type uuid using '11111111-1111-4111-8111-111111111111'::uuid;"
set +e
psql -d "$TYPE_DB" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql" >/tmp/line-type-refuse.txt 2>&1
type_status=$?
set -e
if [[ "$type_status" -eq 0 ]]; then
  echo "migration accepted a uuid line_customer_bindings.organization_id" >&2
  exit 1
fi
psql -d "$TYPE_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
begin
  if (select udt_name from information_schema.columns
      where table_name = 'line_customer_bindings' and column_name = 'organization_id') <> 'uuid' then
    raise exception 'failed migration rewrote line_customer_bindings.organization_id';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_name = 'booking_source_customer_links' and column_name = 'link_origin'
  ) then
    raise exception 'failed type check still added link_origin';
  end if;
end $$;
SQL
dropdb --if-exists "$TYPE_DB"

COLUMN_DB="beauty_os_line_binding_column_refuse"
dropdb --if-exists "$COLUMN_DB"
createdb "$COLUMN_DB"
psql -d "$COLUMN_DB" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/tests/stored-value-checkout-atomic.local-stub.sql" >/dev/null
psql -d "$COLUMN_DB" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/migrations/20261115140000_customer_wallet_identity.sql" >/dev/null
psql -d "$COLUMN_DB" -v ON_ERROR_STOP=1 -X -q -f "$ROOT/supabase/migrations/20261115170000_booking_source_customer_links.sql" >/dev/null
psql -d "$COLUMN_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
insert into public.customers (id, organization_id, status, app_id)
values ('faafffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ACTIVE', 'cust-column-keep');
insert into public.stored_value_accounts (id, organization_id, customer_id, currency, status)
values (
  'f0afffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111',
  'faafffff-ffff-4fff-8fff-ffffffffffff', 'TWD', 'ACTIVE'
);
insert into public.stored_value_ledger_entries (
  organization_id, account_id, customer_id, type, amount_delta_minor, effect_key, created_by_staff_id
) values (
  '11111111-1111-4111-8111-111111111111', 'f0afffff-ffff-4fff-8fff-ffffffffffff',
  'faafffff-ffff-4fff-8fff-ffffffffffff', 'TOP_UP', 2100, 'column-ledger-keep', 'staff-owner-test'
);
alter table public.line_customer_bindings drop column confirmed_at;
SQL
set +e
psql -d "$COLUMN_DB" -v ON_ERROR_STOP=1 -X -q --single-transaction -f "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql" >/tmp/line-column-refuse.txt 2>&1
column_status=$?
set -e
if [[ "$column_status" -eq 0 ]]; then
  echo "migration accepted a line binding table without confirmed_at" >&2
  exit 1
fi
psql -d "$COLUMN_DB" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
begin
  if to_regprocedure('public.line_binding_resolved_customer_id(jsonb)') is not null
     or to_regprocedure('public.line_binding_customer_in_org(uuid, jsonb)') is not null then
    raise exception 'failed lifecycle check left a resolver function';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_name = 'booking_source_customer_links' and column_name = 'link_origin'
  ) then
    raise exception 'failed lifecycle check still added link_origin';
  end if;
  if to_regclass('public.member_binding_requests') is not null then
    raise exception 'failed lifecycle check still created member_binding_requests';
  end if;
  if exists (
    select 1 from pg_trigger where tgname = 'trg_stored_value_ledger_current_line'
  ) then
    raise exception 'failed lifecycle check still installed the ledger gate';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_stored_value_ledger_immutable'
  ) then
    raise exception 'failed lifecycle check removed the immutable ledger trigger';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_name = 'line_customer_bindings' and column_name = 'confirmed_at'
  ) then
    raise exception 'failed lifecycle check recreated confirmed_at';
  end if;
  if (select amount_delta_minor from public.stored_value_ledger_entries where effect_key = 'column-ledger-keep') <> 2100 then
    raise exception 'failed lifecycle check changed the historical ledger';
  end if;
end $$;
SQL
dropdb --if-exists "$COLUMN_DB"
dropdb --if-exists "$PROD_DB"
echo "production-shaped LINE migration cases passed"
