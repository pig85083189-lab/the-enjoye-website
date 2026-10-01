/**
 * Canonical appointment remote mapping.
 * Domain SoT is ScheduleAppointment (lib/appointments/store), not CRM snapshots.
 */

import type { CanonicalAppointmentStatus, ScheduleAppointment } from "@/lib/appointments/domain";
import { normalizeAppointmentStatus } from "@/lib/appointments/domain";
import type { DbAppointment } from "./operational-rows";

export function mergeInternalNote(appointment: Pick<ScheduleAppointment, "internalNote" | "notes">): string | null {
  const direct = appointment.internalNote?.trim();
  if (direct) return direct;
  const fromNotes = (appointment.notes ?? []).map((item) => item.trim()).filter(Boolean).join("\n");
  return fromNotes || null;
}

export function notesFromInternalNote(internalNote: string | null): string[] {
  if (!internalNote) return [];
  return [internalNote];
}

export function assertAppointmentTimeRange(startAt: string, endAt: string): void {
  if (!(new Date(endAt).getTime() > new Date(startAt).getTime())) {
    throw new Error("endAt must be after startAt");
  }
}

export function appointmentFromRemoteRow(
  organizationAppId: string,
  locationAppId: string,
  customerAppId: string,
  serviceAppId: string,
  row: DbAppointment,
): ScheduleAppointment {
  const status = normalizeAppointmentStatus(row.status);
  return {
    id: row.app_id,
    organizationId: organizationAppId,
    locationId: locationAppId,
    customerId: customerAppId,
    customerName: row.customer_name_snapshot ?? "",
    serviceId: serviceAppId,
    serviceName: row.service_name_snapshot ?? "",
    staffId: row.staff_id ?? "",
    staffName: row.staff_name_snapshot ?? "",
    startAt: row.starts_at,
    endAt: row.ends_at,
    durationMinutes: row.duration_minutes ?? 0,
    status,
    customerNote: row.customer_note ?? undefined,
    internalNote: row.internal_note ?? undefined,
    notes: notesFromInternalNote(row.internal_note),
    statusReason: row.status_reason ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    cancelledBy: row.cancelled_by ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedBy: row.updated_by ?? undefined,
    updatedAt: row.updated_at,
  };
}

export const REMOTE_APPOINTMENT_COLUMNS = [
  "id",
  "organization_id",
  "location_id",
  "customer_id",
  "service_id",
  "staff_id",
  "app_id",
  "starts_at",
  "ends_at",
  "duration_minutes",
  "status",
  "customer_note",
  "internal_note",
  "customer_name_snapshot",
  "service_name_snapshot",
  "staff_name_snapshot",
  "status_reason",
  "cancelled_at",
  "cancelled_by",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at",
] as const;

export function remoteAppointmentPayload(row: DbAppointment): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const column of REMOTE_APPOINTMENT_COLUMNS) {
    payload[column] = row[column];
  }
  if ("remainingSessions" in payload || "notes" in payload) {
    throw new Error("appointment remote payload leaked domain-only fields");
  }
  return payload;
}

export function toRemoteAppointmentStatus(
  status: CanonicalAppointmentStatus,
): CanonicalAppointmentStatus {
  return status;
}
