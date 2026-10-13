import { NextResponse } from "next/server";
import {
  isAppointmentReminderCronDispatchOpen,
  isAppointmentReminderSendOpen,
} from "@/lib/line/automations/appointment-reminder-flag";
import { authorizeAppointmentReminderCron } from "@/lib/line/automations/appointment-reminder-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const authorized = authorizeAppointmentReminderCron({
    authorization: request.headers.get("authorization"),
    vercelCron: request.headers.get("x-vercel-cron"),
  });
  if (!authorized.ok) {
    return NextResponse.json(
      { ok: false, skipped: true, message: authorized.message },
      { status: authorized.status },
    );
  }

  if (!isAppointmentReminderCronDispatchOpen() || !isAppointmentReminderSendOpen()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "send_closed",
      message: "預約提醒正式發送尚未開放，Cron 不會領取或發送",
    });
  }

  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: "send_closed",
    message: "預約提醒正式發送尚未開放，Cron 不會領取或發送",
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
