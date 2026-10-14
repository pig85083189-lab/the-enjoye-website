#!/usr/bin/env bash
# Preview dry-run acceptance checklist. Never connects remotely.
# Owner must approve Preview database operations before anyone applies SQL.
set -euo pipefail

if [[ "${PGHOST:-}" != "" || "${DATABASE_URL:-}" != "" || "${SUPABASE_DB_URL:-}" != "" ]]; then
  echo "REFUSE: unset PGHOST, DATABASE_URL, and SUPABASE_DB_URL. This is a checklist only." >&2
  exit 1
fi

cat <<'PLAN'
Beauty OS LINE appointment reminder — Preview dry-run plan

Database IDs
- Preview Supabase project: bfzquejrtgqzzarhkiya
- Production Supabase project: knccefcxncglgpmvgqlp
- Do not write Production. Do not apply this plan until Owner approves.

Required Preview env names (values must not be printed or committed)
- VERCEL_ENV=preview
- NEXT_PUBLIC_SUPABASE_URL host must be bfzquejrtgqzzarhkiya.supabase.co
- BEAUTY_OS_LINE_APPOINTMENT_REMINDER_PERSIST_OPEN
- BEAUTY_OS_LINE_APPOINTMENT_REMINDER_DRY_RUN_OPEN
- CRON_SECRET
- BEAUTY_OS_LINE_CREDENTIAL_KEY
Never set BEAUTY_OS_LINE_APPOINTMENT_REMINDER_SEND_OPEN. Hardcoded send stays false.

Migration order after Owner approval
1. Confirm Preview already has through 20261012120000_line_broadcast_channel_lock.sql
2. Apply 20261013120000_line_appointment_reminder_automation.sql
3. Apply 20261013140000_line_appointment_reminder_phase_2c.sql
4. Apply 20261014120000_line_appointment_reminder_postgrest_service_role.sql
   only after Phase 2D-3 Owner approval. Do not apply it in 2D-3 local-only work.
Do not apply any of these files to Production.

Hobby Cron
- vercel.json stays 0 3 * * *
- Manual trigger: scripts/line-appointment-reminder-hobby-dry-run.sh
- Cron calls run_line_appointment_reminder_cron_dry_run(), not the owner RPC.

Dry-run acceptance (Preview TEST org only, fake customers only)
1. Create a Preview-only test customer. Never use Production / official LINE customers.
2. Create a future BOOKED test appointment for that customer.
3. Owner saves appointment reminder rule (persist Preview-only).
4. Confirm jobs were created for the appointment.
5. Simulate due time or wait until scheduled_for is past.
6. Run Dry-run from /staff/line/automations or Cron Bearer CRON_SECRET.
7. Confirm Dry-run rows, sent=false, no LINE Push.
8. Reschedule or cancel the appointment.
9. Confirm old jobs are canceled / void and no new send occurs.

Hard stops
- Do not send any LINE message
- Do not call LINE Push API
- Do not affect Production Broadcast
- Do not write Production Supabase
- Do not leak customer LINE userId
- Do not use real customers
PLAN
