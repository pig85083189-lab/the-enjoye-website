#!/usr/bin/env bash
# Local-only Phase 2F-1 PostgreSQL review. Unix socket only.
# Never connect to Preview / Production. Never call LINE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="beauty_os_line_2f1_local"
PSQL=(psql -d "$DB" -v ON_ERROR_STOP=1 -X -q)

if [[ "${PGHOST:-}" != "" || "${DATABASE_URL:-}" != "" ]]; then
  echo "REFUSE: unset PGHOST and DATABASE_URL so this stays on the local unix socket." >&2
  exit 1
fi

dropdb --if-exists "$DB"
createdb "$DB"

"${PSQL[@]}" -f "$ROOT/supabase/tests/line-owner-self-reminder-grant-production.local-stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/drafts/20261016120000_line_owner_self_reminder_grant_production.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/line-owner-self-reminder-grant-production.local-cases.sql"

dropdb "$DB"
echo "PHASE_2F1_LOCAL_PG_PASS"
