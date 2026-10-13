import { timingSafeEqual } from "node:crypto";
import {
  isAppointmentReminderCronDispatchOpen,
  isAppointmentReminderDryRunOpen,
  LINE_APPOINTMENT_REMINDER_CRON_SECRET_ENV,
} from "@/lib/line/automations/appointment-reminder-flag";

export function authorizeAppointmentReminderCron(input: {
  authorization?: string | null;
  vercelCron?: string | null;
  env?: NodeJS.Dict<string>;
}): { ok: true } | { ok: false; status: number; message: string } {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const secret = (env[LINE_APPOINTMENT_REMINDER_CRON_SECRET_ENV] ?? "").trim();
  if (!secret || secret.length < 16) {
    return { ok: false, status: 401, message: "Cron Secret 未設定或長度不足" };
  }
  const header = (input.authorization ?? "").trim();
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return { ok: false, status: 401, message: "Cron 驗證失敗" };
  }
  const left = Buffer.from(token);
  const right = Buffer.from(secret);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, status: 401, message: "Cron 驗證失敗" };
  }
  return { ok: true };
}

export function appointmentReminderCronMode(input: {
  env?: NodeJS.Dict<string>;
  dispatchOpen?: boolean;
  dryRunOpen?: boolean;
}): "closed" | "dry_run" | "dispatch" {
  if (isAppointmentReminderCronDispatchOpen(input.dispatchOpen)) return "dispatch";
  if (isAppointmentReminderDryRunOpen({ env: input.env, override: input.dryRunOpen })) {
    return "dry_run";
  }
  return "closed";
}
