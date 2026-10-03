/**
 * Idempotent insert-only create for a future Appointment write pilot.
 * Uses a stable pre-generated app id. Never upserts. Never writes localStorage.
 */

import { hasAppointmentConflict, type ScheduleAppointment } from "@/lib/appointments/domain";
import { isGeneratedAppointmentAppId } from "@/lib/persistence/demo-firewall";
import { APPOINTMENT_INSERT_ONLY_MESSAGE } from "@/lib/persistence/authenticated-appointment-store";
import type { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";
import { APPOINTMENT_STAFF_OVERLAP_MESSAGE } from "./appointment-queries";
import type { PreparedAppointmentCreate } from "./appointment-write-command";

export const APPOINTMENT_WRITE_INTEGRITY_MESSAGE =
  "Appointment app id already exists with a different payload";

export const APPOINTMENT_WRITE_RETRYABLE_MESSAGE =
  "Appointment create commit state is unknown; retry with the same app id";

export class AppointmentWriteIntegrityError extends Error {
  constructor(message = APPOINTMENT_WRITE_INTEGRITY_MESSAGE) {
    super(message);
    this.name = "AppointmentWriteIntegrityError";
  }
}

export class AppointmentWriteRetryableError extends Error {
  constructor(message = APPOINTMENT_WRITE_RETRYABLE_MESSAGE) {
    super(message);
    this.name = "AppointmentWriteRetryableError";
  }
}

export type AppointmentWriteHost = {
  appointments: Pick<AppointmentRemoteAdapter, "create" | "get" | "list">;
};

export type AppointmentSafeCreateOutcome = "created" | "recovered";

function sameInstant(left: string, right: string): boolean {
  return new Date(left).getTime() === new Date(right).getTime();
}

export function appointmentMatchesPreparedCreate(
  row: ScheduleAppointment,
  command: PreparedAppointmentCreate,
): boolean {
  return (
    row.id === command.appointmentId &&
    row.organizationId === command.organizationId &&
    row.locationId === command.locationId &&
    row.customerId === command.customerId &&
    row.serviceId === command.serviceId &&
    row.staffId === command.staffId &&
    row.status === "BOOKED" &&
    sameInstant(row.startAt, command.startAt) &&
    sameInstant(row.endAt, command.endAt)
  );
}

function isDuplicateAppIdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(APPOINTMENT_INSERT_ONLY_MESSAGE) ||
    /duplicate key|unique constraint|idx_appointments_org_app_id|23505/i.test(message)
  );
}

function isAmbiguousCommitError(error: unknown): boolean {
  if (isDuplicateAppIdError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|network|fetch|abort|empty response|Failed to fetch/i.test(message);
}

async function readBackPrepared(
  command: PreparedAppointmentCreate,
  persistence: AppointmentWriteHost,
): Promise<ScheduleAppointment | undefined> {
  return persistence.appointments.get(command.organizationId, command.appointmentId);
}

async function recoverOrConflict(
  command: PreparedAppointmentCreate,
  persistence: AppointmentWriteHost,
  whenMissing: "integrity" | "retryable",
): Promise<ScheduleAppointment> {
  const existing = await readBackPrepared(command, persistence);
  if (!existing) {
    if (whenMissing === "integrity") {
      throw new AppointmentWriteIntegrityError(
        "Duplicate appointment app id reported but no canonical row was found",
      );
    }
    throw new AppointmentWriteRetryableError();
  }
  if (!appointmentMatchesPreparedCreate(existing, command)) {
    throw new AppointmentWriteIntegrityError();
  }
  return existing;
}

export async function createAppointmentSafely(
  command: PreparedAppointmentCreate,
  persistence: AppointmentWriteHost,
): Promise<{ appointment: ScheduleAppointment; outcome: AppointmentSafeCreateOutcome }> {
  if (!isGeneratedAppointmentAppId(command.appointmentId)) {
    throw new Error('Appointment app id must be generated via newId("apt")');
  }
  if (command.status !== "BOOKED") {
    throw new Error("Appointment write create status must be BOOKED");
  }

  const existing = await persistence.appointments.list({
    organizationId: command.organizationId,
  });
  const overlap = hasAppointmentConflict(
    {
      id: command.appointmentId,
      staffId: command.staffId,
      startAt: command.startAt,
      endAt: command.endAt,
      status: "BOOKED",
    },
    existing,
  );
  if (overlap) {
    throw new Error(APPOINTMENT_STAFF_OVERLAP_MESSAGE);
  }

  try {
    const created = await persistence.appointments.create(command.organizationId, {
      id: command.appointmentId,
      locationId: command.locationId,
      customerId: command.customerId,
      serviceId: command.serviceId,
      staffId: command.staffId,
      startAt: command.startAt,
      endAt: command.endAt,
      createdBy: command.createdBy,
      customerNote: command.customerNote,
      internalNote: command.internalNote,
      customerName: command.customerName,
      serviceName: command.serviceName,
      staffName: command.staffName,
      status: "BOOKED",
    });
    if (created.id !== command.appointmentId) {
      throw new AppointmentWriteIntegrityError(
        "Create returned a different appointment app id",
      );
    }
    if (created.status !== "BOOKED") {
      throw new AppointmentWriteIntegrityError("Create must persist BOOKED");
    }
    return { appointment: created, outcome: "created" };
  } catch (error) {
    if (error instanceof AppointmentWriteIntegrityError) throw error;
    if (isDuplicateAppIdError(error)) {
      const recovered = await recoverOrConflict(command, persistence, "integrity");
      return { appointment: recovered, outcome: "recovered" };
    }
    if (isAmbiguousCommitError(error)) {
      const recovered = await recoverOrConflict(command, persistence, "retryable");
      return { appointment: recovered, outcome: "recovered" };
    }
    throw error;
  }
}
