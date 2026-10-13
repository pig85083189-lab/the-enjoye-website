import { isAppointmentReminderPersistOpen } from "@/lib/line/automations/appointment-reminder-flag";
import type { AppointmentReminderAppointment } from "@/lib/line/automations/appointment-reminder-types";

export type AppointmentReminderWriteChange =
  | "created"
  | "rescheduled"
  | "customer_changed"
  | "service_changed"
  | "cancelled"
  | "completed"
  | "status_changed";

/**
 * Appointment write path hook. Persist is closed this phase, so this is a no-op
 * and never talks to LINE or the database.
 */
export function notifyAppointmentWrittenForReminders(input: {
  organizationId: string;
  appointment: Pick<AppointmentReminderAppointment, "id" | "organizationId" | "status">;
  change: AppointmentReminderWriteChange;
  persistOpen?: boolean;
}): { synced: false; reason: "persist_closed" | "cross_org" } {
  if (input.appointment.organizationId !== input.organizationId) {
    return { synced: false, reason: "cross_org" };
  }
  if (!isAppointmentReminderPersistOpen(input.persistOpen)) {
    return { synced: false, reason: "persist_closed" };
  }
  return { synced: false, reason: "persist_closed" };
}
