#!/usr/bin/env bash
# Local-only Phase 2B → Phase 1 line_automation_rules upgrade review.
# Unix socket only. Never connect to Preview / Production. Never call LINE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_rules_upgrade_local"
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

"${PSQL[@]}" -f "$ROOT/supabase/tests/line-automation-rules-phase2b-upgrade.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017120000_line_automation_rules.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261017120000_line_automation_rules.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-automation-rules-phase2b-upgrade.local-cases.sql"

echo "PASS: local Phase 2B schema upgraded to Phase 1 without dropping legacy rows or RPCs."
