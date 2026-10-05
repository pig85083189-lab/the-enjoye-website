/**
 * Treatment entry identity vs Treatment record persistence.
 *
 * Customer identity is canonical remote Customer (cust-*) when the
 * Customer remote-read pilot is on. Treatment drafts / completed records
 * stay local-only unless the Treatment remote-read pilot is on.
 *
 * Appointment identity may also come from the authenticated remote
 * Appointment adapter so an existing Treatment workspace can open.
 * That is not a second identity system and must not copy customers
 * into localStorage or guess by name / phone.
 */

import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { scheduleAppointmentToLegacyView } from "@/lib/appointment-store";
import type { Appointment } from "@/types";

export type TreatmentIdentitySource = "remote" | "local";

export function resolveTreatmentCustomerIdentitySource(
  customerRemoteReadPilot: boolean,
): TreatmentIdentitySource {
  return customerRemoteReadPilot ? "remote" : "local";
}

export function resolveTreatmentAppointmentIdentitySource(
  appointmentRemoteReadPilot: boolean,
): TreatmentIdentitySource {
  return appointmentRemoteReadPilot ? "remote" : "local";
}

const OPEN_REMOTE_STATUSES = new Set([
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "IN_SERVICE",
]);

export function pickRemoteAppointmentForCustomer(
  rows: ScheduleAppointment[],
): ScheduleAppointment | undefined {
  return (
    rows.find((item) => OPEN_REMOTE_STATUSES.has(item.status)) ??
    rows.find((item) => item.status !== "CANCELLED" && item.status !== "NO_SHOW")
  );
}

export function toTreatmentAppointment(row: ScheduleAppointment): Appointment {
  return scheduleAppointmentToLegacyView(row);
}

export function treatmentWorkspaceEntryHref(input: {
  customerId: string;
  appointmentId?: string;
}): string {
  if (input.appointmentId) {
    return `/staff/treatments/new?customer=${input.customerId}&appointment=${input.appointmentId}`;
  }
  return `/staff/treatments/new?customer=${input.customerId}`;
}
