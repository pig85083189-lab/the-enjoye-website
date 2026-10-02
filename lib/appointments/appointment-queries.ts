/**
 * Async appointment application boundary for a future authenticated remote write.
 * Live Calendar / Today still use lib/appointments/store this phase.
 * This module does not construct a bootstrap route and does not write unless called.
 */

import type { CreateAppointmentInput } from "@/lib/appointments/store";
import {
  hasAppointmentConflict,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import { isGeneratedAppointmentAppId } from "@/lib/persistence/demo-firewall";
import type { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";

export const APPOINTMENT_STAFF_OVERLAP_MESSAGE =
  "Overlapping appointment already exists for this staff; insert-only (no upsert)";

export type AppointmentRemoteHost = {
  appointments: Pick<AppointmentRemoteAdapter, "create" | "list">;
};

export async function findStaffTimeOverlap(
  organizationId: string,
  input: Pick<CreateAppointmentInput, "staffId" | "startAt" | "endAt">,
  persistence: AppointmentRemoteHost,
): Promise<ScheduleAppointment | undefined> {
  const existing = await persistence.appointments.list({ organizationId });
  return hasAppointmentConflict(
    {
      id: "",
      staffId: input.staffId,
      startAt: input.startAt,
      endAt: input.endAt,
      status: "BOOKED",
    },
    existing,
  );
}

export async function createAppointmentRecord(
  organizationId: string,
  input: CreateAppointmentInput,
  persistence: AppointmentRemoteHost,
): Promise<ScheduleAppointment> {
  const overlap = await findStaffTimeOverlap(organizationId, input, persistence);
  if (overlap) {
    throw new Error(APPOINTMENT_STAFF_OVERLAP_MESSAGE);
  }
  const created = await persistence.appointments.create(organizationId, input);
  if (!isGeneratedAppointmentAppId(created.id)) {
    throw new Error('Appointment app id must be generated via newId("apt")');
  }
  return created;
}
