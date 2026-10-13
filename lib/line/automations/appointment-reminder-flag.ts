/**
 * Appointment-reminder feature flags. Independent of Broadcast / Owner test-push.
 * Server Components may import this file. Do not import send adapters from RSC.
 * Every switch stays hardcoded closed. Do not add an env bypass this phase.
 */

export const LINE_APPOINTMENT_REMINDER_SEND_OPEN = false;
export const LINE_APPOINTMENT_REMINDER_PERSIST_OPEN = false;
export const LINE_APPOINTMENT_REMINDER_CRON_DISPATCH_OPEN = false;

export const LINE_APPOINTMENT_REMINDER_SEND_OPEN_ENV =
  "BEAUTY_OS_LINE_APPOINTMENT_REMINDER_SEND_OPEN";
export const LINE_APPOINTMENT_REMINDER_PERSIST_OPEN_ENV =
  "BEAUTY_OS_LINE_APPOINTMENT_REMINDER_PERSIST_OPEN";
export const LINE_APPOINTMENT_REMINDER_CRON_SECRET_ENV = "CRON_SECRET";

export const APPOINTMENT_REMINDER_CRON_MINUTES = 15;
export const APPOINTMENT_REMINDER_CLAIM_GRACE_MINUTES = 20;
export const APPOINTMENT_REMINDER_CLAIM_GRACE_MS =
  APPOINTMENT_REMINDER_CLAIM_GRACE_MINUTES * 60_000;
export const APPOINTMENT_REMINDER_TEXT_MAX = 5000;

export function isAppointmentReminderSendOpen(
  override?: boolean,
): boolean {
  return override ?? LINE_APPOINTMENT_REMINDER_SEND_OPEN;
}

export function isAppointmentReminderPersistOpen(
  override?: boolean,
): boolean {
  return override ?? LINE_APPOINTMENT_REMINDER_PERSIST_OPEN;
}

export function isAppointmentReminderCronDispatchOpen(
  override?: boolean,
): boolean {
  return override ?? LINE_APPOINTMENT_REMINDER_CRON_DISPATCH_OPEN;
}

export function allAppointmentReminderFlagsClosed(): boolean {
  return (
    LINE_APPOINTMENT_REMINDER_SEND_OPEN === false &&
    LINE_APPOINTMENT_REMINDER_PERSIST_OPEN === false &&
    LINE_APPOINTMENT_REMINDER_CRON_DISPATCH_OPEN === false
  );
}
