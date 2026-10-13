/**
 * Appointment-reminder flags. Independent of Broadcast / Owner test-push.
 * Send stays hardcoded closed. Persist / dry-run may open only on Preview
 * via explicit env + Preview Supabase host. Production never opens.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";
import { LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST } from "@/lib/line/line-flag";

export const LINE_APPOINTMENT_REMINDER_SEND_OPEN = false;
export const LINE_APPOINTMENT_REMINDER_PERSIST_OPEN = false;
export const LINE_APPOINTMENT_REMINDER_DRY_RUN_OPEN = false;
export const LINE_APPOINTMENT_REMINDER_CRON_DISPATCH_OPEN = false;

export const LINE_APPOINTMENT_REMINDER_SEND_OPEN_ENV =
  "BEAUTY_OS_LINE_APPOINTMENT_REMINDER_SEND_OPEN";
export const LINE_APPOINTMENT_REMINDER_PERSIST_OPEN_ENV =
  "BEAUTY_OS_LINE_APPOINTMENT_REMINDER_PERSIST_OPEN";
export const LINE_APPOINTMENT_REMINDER_DRY_RUN_OPEN_ENV =
  "BEAUTY_OS_LINE_APPOINTMENT_REMINDER_DRY_RUN_OPEN";
export const LINE_APPOINTMENT_REMINDER_CRON_SECRET_ENV = "CRON_SECRET";

export const APPOINTMENT_REMINDER_CRON_MINUTES = 15;
export const APPOINTMENT_REMINDER_CLAIM_GRACE_MINUTES = 20;
export const APPOINTMENT_REMINDER_CLAIM_GRACE_MS =
  APPOINTMENT_REMINDER_CLAIM_GRACE_MINUTES * 60_000;
export const APPOINTMENT_REMINDER_STALE_CLAIMED_SECONDS = 30;
export const APPOINTMENT_REMINDER_TEXT_MAX = 5000;

function reminderSupabaseHostname(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): string | null {
  const raw = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function isPreviewReminderEnvironment(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if ((env.VERCEL_ENV ?? "").trim() === "production") return false;
  if ((env.VERCEL_ENV ?? "").trim() !== "preview") return false;
  return reminderSupabaseHostname(env) === LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST;
}

export function isAppointmentReminderSendOpen(override?: boolean): boolean {
  return override ?? LINE_APPOINTMENT_REMINDER_SEND_OPEN;
}

export function isAppointmentReminderPersistOpen(input: {
  env?: NodeJS.Dict<string>;
  override?: boolean;
} = {}): boolean {
  if (input.override === true) return true;
  if (LINE_APPOINTMENT_REMINDER_PERSIST_OPEN) return true;
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  if ((env.VERCEL_ENV ?? "").trim() === "production") return false;
  if (!isPreviewReminderEnvironment(env)) return false;
  return isExplicitRemotePilotEnabled(LINE_APPOINTMENT_REMINDER_PERSIST_OPEN_ENV, env);
}

export function isAppointmentReminderDryRunOpen(input: {
  env?: NodeJS.Dict<string>;
  override?: boolean;
} = {}): boolean {
  if (input.override === true) return true;
  if (LINE_APPOINTMENT_REMINDER_DRY_RUN_OPEN) return true;
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  if ((env.VERCEL_ENV ?? "").trim() === "production") return false;
  if (!isAppointmentReminderPersistOpen({ env })) return false;
  if (isAppointmentReminderSendOpen()) return false;
  return isExplicitRemotePilotEnabled(LINE_APPOINTMENT_REMINDER_DRY_RUN_OPEN_ENV, env);
}

export function isAppointmentReminderCronDispatchOpen(override?: boolean): boolean {
  return override ?? LINE_APPOINTMENT_REMINDER_CRON_DISPATCH_OPEN;
}

export function allAppointmentReminderFlagsClosed(): boolean {
  return (
    LINE_APPOINTMENT_REMINDER_SEND_OPEN === false &&
    LINE_APPOINTMENT_REMINDER_PERSIST_OPEN === false &&
    LINE_APPOINTMENT_REMINDER_DRY_RUN_OPEN === false &&
    LINE_APPOINTMENT_REMINDER_CRON_DISPATCH_OPEN === false
  );
}
