import { isAppointmentReminderPersistOpen } from "@/lib/line/automations/appointment-reminder-flag";
import { createAppointmentReminderSupabaseRepository } from "@/lib/line/automations/appointment-reminder-supabase";
import { createDefaultAppointmentReminderRule } from "@/lib/line/automations/appointment-reminder-rules";
import type { AppointmentReminderAppointment } from "@/lib/line/automations/appointment-reminder-types";
import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";

export type AppointmentReminderWriteChange =
  | "created"
  | "rescheduled"
  | "customer_changed"
  | "service_changed"
  | "cancelled"
  | "completed"
  | "status_changed";

export type AppointmentReminderRpcClient = {
  // Supabase rpc is a thenable builder with generic overloads.
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export type AppointmentReminderWriteAppointment = Pick<
  AppointmentReminderAppointment,
  "id" | "organizationId" | "status"
> &
  Partial<
    Pick<
      AppointmentReminderAppointment,
      "customerId" | "customerName" | "serviceId" | "serviceName" | "locationName" | "startAt" | "endAt"
    >
  > & {
    status: CanonicalAppointmentStatus;
  };

export function appointmentReminderFromWrite(
  row: AppointmentReminderWriteAppointment,
): AppointmentReminderAppointment | null {
  if (
    !row.id ||
    !row.organizationId?.startsWith("org-") ||
    !row.customerId ||
    !row.serviceId ||
    !row.startAt ||
    !row.endAt
  ) {
    return null;
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    customerId: row.customerId,
    customerName: row.customerName ?? "",
    serviceId: row.serviceId,
    serviceName: row.serviceName ?? "",
    locationName: row.locationName,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
  };
}

/**
 * Appointment write hook. Persist stays Preview-allowlist only.
 * Cancels stale jobs then inserts planned jobs. Never sends LINE.
 * Production always no-ops.
 */
export async function notifyAppointmentWrittenForReminders(input: {
  organizationId: string;
  appointment: AppointmentReminderWriteAppointment;
  change: AppointmentReminderWriteChange;
  persistOpen?: boolean;
  client?: AppointmentReminderRpcClient;
  env?: NodeJS.Dict<string>;
}): Promise<{ synced: boolean; reason: "persist_closed" | "cross_org" | "synced" | "error" }> {
  if (input.appointment.organizationId !== input.organizationId) {
    return { synced: false, reason: "cross_org" };
  }
  if (!isAppointmentReminderPersistOpen({ env: input.env, override: input.persistOpen })) {
    return { synced: false, reason: "persist_closed" };
  }
  if (!input.client) {
    return { synced: false, reason: "persist_closed" };
  }
  const mapped = appointmentReminderFromWrite(input.appointment);
  const repo = createAppointmentReminderSupabaseRepository(input.client);
  if (!mapped) {
    const canceled = await input.client.rpc("sync_line_appointment_reminder_jobs", {
      p_organization_id: input.organizationId,
      p_appointment_app_id: input.appointment.id,
    });
    return canceled.error ? { synced: false, reason: "error" } : { synced: true, reason: "synced" };
  }
  const rule =
    (await repo.getRule(input.organizationId)) ??
    createDefaultAppointmentReminderRule(input.organizationId);
  try {
    await repo.syncAppointment(input.organizationId, mapped, rule);
    return { synced: true, reason: "synced" };
  } catch {
    return { synced: false, reason: "error" };
  }
}
