#!/usr/bin/env bash
# Hobby-safe manual Dry-run trigger. Never prints secrets or customer data.
# Default is a local checklist. --execute curls Preview only when explicitly asked.
# Does not apply SQL. Does not call LINE. Does not touch Production.
set -euo pipefail

if [[ "${PGHOST:-}" != "" || "${DATABASE_URL:-}" != "" || "${SUPABASE_DB_URL:-}" != "" ]]; then
  echo "REFUSE: unset PGHOST, DATABASE_URL, and SUPABASE_DB_URL." >&2
  exit 1
fi

usage() {
  cat <<'PLAN'
Beauty OS LINE appointment reminder — Hobby Dry-run trigger

Vercel Hobby only accepts daily Cron. Current vercel.json stays:
  0 3 * * *

Do not change this to */15 on Hobby. CLI deploy rejects it.

Safe manual Dry-run (Owner, Preview TEST org only)
1. Confirm Preview SQL 20261014120000 has been applied (Owner-approved).
2. Export CRON_SECRET from the shell. Do not paste it into chat, git, or logs.
3. Export PREVIEW_CRON_URL=https://<preview-host>/api/cron/line-appointment-reminders
4. Run:
     scripts/line-appointment-reminder-hobby-dry-run.sh --execute
5. Expected:
     - missing/wrong Bearer -> HTTP 401
     - RPC privilege/missing SQL -> HTTP 500, ok=false, sent=false
     - success -> HTTP 200, mode=dry_run, sent=false
6. Response must not include CRON_SECRET, LINE userId, tokens, or customer rows.

Future 15-minute reminder options (not this phase)
- Vercel Pro / Enterprise Cron can use */15 * * * *
- Or an independently verified scheduler (signed Bearer CRON_SECRET only)
  such as GitHub Actions schedule or a locked worker, still calling this route
- Supabase pg_cron is not authorized here; it would need its own privilege review
This phase does not upgrade the plan, add a paid service, or open real send.

Hard stops
- Do not apply SQL from this script
- Do not call api.line.me
- Do not use Production host knccefcxncglgpmvgqlp
- Do not print Authorization or CRON_SECRET
PLAN
}

if [[ "${1:-}" != "--execute" ]]; then
  usage
  exit 0
fi

SECRET="${CRON_SECRET:-}"
URL="${PREVIEW_CRON_URL:-}"
if [[ "${#SECRET}" -lt 16 ]]; then
  echo "REFUSE: CRON_SECRET missing or shorter than 16." >&2
  exit 1
fi
if [[ "$URL" != https://*"/api/cron/line-appointment-reminders" ]]; then
  echo "REFUSE: PREVIEW_CRON_URL must be https Preview cron path." >&2
  exit 1
fi
if [[ "$URL" == *"knccefcxncglgpmvgqlp"* || "$URL" == *".vercel.app/api/line"* ]]; then
  echo "REFUSE: Production or LINE URL is not allowed." >&2
  exit 1
fi

TMP="$(mktemp)"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

STATUS="$(
  curl -sS -o "$TMP" -w "%{http_code}" \
    -X POST \
    -H "authorization: Bearer ${SECRET}" \
    -H "content-type: application/json" \
    "$URL"
)"

if grep -Eiq 'CRON_SECRET|U[0-9a-f]{32}|channel_access_token|Bearer |line_user_id|eyJ' "$TMP"; then
  echo "REFUSE: cron response looked like it leaked a secret or customer id." >&2
  exit 1
fi

echo "http_status=${STATUS}"
python3 - "$TMP" <<'PY'
import json, sys
path = sys.argv[1]
raw = open(path, encoding="utf-8").read().strip()
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print("body_kind=non_json")
    sys.exit(0)
allowed = ("ok", "skipped", "mode", "sent", "checked", "message", "reason")
safe = {key: data[key] for key in allowed if key in data}
print("body=" + json.dumps(safe, ensure_ascii=False, separators=(",", ":")))
PY
