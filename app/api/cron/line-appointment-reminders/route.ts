import { NextResponse } from "next/server";
import {
  appointmentReminderCronMode,
  authorizeAppointmentReminderCron,
} from "@/lib/line/automations/appointment-reminder-cron";
import { isAppointmentReminderSendOpen } from "@/lib/line/automations/appointment-reminder-flag";
import {
  FINALIZE_STALE_LINE_APPOINTMENT_REMINDER_CLAIMED_RPC,
  RUN_LINE_APPOINTMENT_REMINDER_DRY_RUN_RPC,
} from "@/lib/line/automations/appointment-reminder-rpc";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const authorized = authorizeAppointmentReminderCron({
    authorization: request.headers.get("authorization"),
  });
  if (!authorized.ok) {
    return NextResponse.json(
      { ok: false, skipped: true, message: authorized.message },
      { status: authorized.status },
    );
  }

  if (isAppointmentReminderSendOpen()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "send_closed",
      message: "正式 LINE Push 必須保持關閉",
    });
  }

  const mode = appointmentReminderCronMode({});
  if (mode === "closed") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "send_closed",
      message: "預約提醒 Cron 尚未開放 Dry-run 或發送",
    });
  }

  if (mode === "dry_run") {
    const admin = createServiceRoleClient();
    if (!admin) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "not_configured",
        message: "Dry-run 已允許但沒有可寫入的 server client，沒有發送 LINE",
      });
    }
    await admin.rpc(FINALIZE_STALE_LINE_APPOINTMENT_REMINDER_CLAIMED_RPC, {
      p_stale_after_seconds: 30,
    });
    const tick = await admin.rpc(RUN_LINE_APPOINTMENT_REMINDER_DRY_RUN_RPC, {
      p_organization_id: null,
    });
    return NextResponse.json({
      ok: true,
      skipped: false,
      mode: "dry_run",
      sent: false,
      checked: Number((tick.data as { checked?: unknown } | null)?.checked ?? 0),
      message: "Dry-run 只做檢查與紀錄，不會連接 LINE Push",
    });
  }

  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: "send_closed",
    sent: false,
    message: "正式發送關閉，Cron 不會 Push",
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
