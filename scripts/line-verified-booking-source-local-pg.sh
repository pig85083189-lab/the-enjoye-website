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
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261116120000_line_verified_booking_source_link.sql"
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
