#!/usr/bin/env bash
# Local-only Phase 2E-9 PostgreSQL privilege review. Unix socket only.
# Never connect to Preview / Production. Never call LINE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_2e9_local"
PSQL=(psql -d "$DB" -v ON_ERROR_STOP=1 -X -q)

if [[ "${PGHOST:-}" != "" || "${DATABASE_URL:-}" != "" ]]; then
  echo "REFUSE: unset PGHOST and DATABASE_URL so this stays on the local unix socket." >&2
  exit 1
fi

dropdb --if-exists "$DB"
createdb "$DB"

"${PSQL[@]}" -f "$ROOT/supabase/tests/line-owner-self-reminder-grant.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/drafts/20261014180000_line_owner_self_reminder_grant.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-owner-self-reminder-grant.local-cases.sql"

dropdb "$DB"
echo "PHASE_2E9_LOCAL_PG_PASS"
