#!/bin/bash
# Local socket only. Refuses any configured remote database target.
set -euo pipefail
if [[ -n "${PGHOST:-}" || -n "${DATABASE_URL:-}" || -n "${SUPABASE_DB_URL:-}" || -n "${PGHOSTADDR:-}" ]]; then
  echo "refusing non-local database target" >&2
  exit 2
fi
cd "$(dirname "$0")/../.."
db="line_member_link_$$"
trap 'dropdb --if-exists "$db"' EXIT
createdb "$db"
psql -v ON_ERROR_STOP=1 -d "$db" -f supabase/tests/line-member-customer-link.local.sql >/tmp/line-member-customer-link.local.out
grep -q "verified_at must be nullable" /tmp/line-member-customer-link.local.out && exit 1 || true
echo "line member customer link isolated cases passed"
