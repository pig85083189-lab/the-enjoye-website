#!/usr/bin/env bash
# Local-only Preview leftover LINE bind upgrade review.
# Unix socket only. Never connect to Preview / Production. Never call LINE.
# Simulates Preview where 20261017160000 is already recorded, so only 161000 runs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_bindings_preview_upgrade_local"
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

"${PSQL[@]}" -f "$ROOT/supabase/tests/line-customer-bindings-preview-upgrade.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017140000_line_automation_schedule_engine.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017140000_line_automation_schedule_engine.sql"
# Preview already recorded 160000 against the leftover schema. Do not apply it.
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017161000_line_customer_bindings_preview_upgrade.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017161000_line_customer_bindings_preview_upgrade.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-customer-bindings-preview-upgrade.local-cases.sql"

echo "PASS: local Preview leftover bindings upgraded without dropping rows or sending LINE."
