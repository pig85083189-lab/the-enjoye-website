/**
 * Optimistic remote Appointment mutation. Never upserts. Never writes browser storage.
 * Overlap authority is appointments_staff_active_no_overlap (23P01), not the local conflict helper.
 */

import type { ScheduleAppointment } from "@/lib/appointments/domain";
import type { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";
import {
  AppointmentConflictError,
  AppointmentWriteIntegrityError,
  AppointmentWriteRetryableError,
  isAppointmentExclusionConflictError,
} from "./appointment-write-create";
import type { PreparedAppointmentMutate } from "./appointment-write-mutate-command";
import {
  APPOINTMENT_EXPECTED_UPDATED_AT_REQUIRED_MESSAGE,
  AppointmentWriteNotFoundError,
  AppointmentWriteStaleError,
  AppointmentWriteZeroRowError,
} from "./appointment-write-mutate-errors";

export {
  AppointmentConflictError,
  AppointmentWriteIntegrityError,
  AppointmentWriteRetryableError,
  isAppointmentExclusionConflictError,
} from "./appointment-write-create";

export {
  AppointmentCustomerImmutableError,
  AppointmentWriteNotFoundError,
  AppointmentWriteStaleError,
  AppointmentWriteZeroRowError,
} from "./appointment-write-mutate-errors";

export type AppointmentMutateHost = {
  appointments: Pick<AppointmentRemoteAdapter, "update" | "get">;
};

export type AppointmentSafeMutateOutcome = "updated" | "replayed";

function sameInstant(left: string | undefined, right: string | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return new Date(left).getTime() === new Date(right).getTime();
}

export function appointmentMatchesPreparedMutate(
  row: ScheduleAppointment,
  command: PreparedAppointmentMutate,
): boolean {
  return (
    row.id === command.appointmentId &&
    row.organizationId === command.organizationId &&
    row.customerId === command.customerId &&
    row.locationId === command.locationId &&
    row.serviceId === command.serviceId &&
    row.staffId === command.staffId &&
    row.status === command.status &&
    sameInstant(row.startAt, command.startAt) &&
    sameInstant(row.endAt, command.endAt)
  );
}

function isAmbiguousCommitError(error: unknown): boolean {
  if (error instanceof AppointmentWriteZeroRowError) return false;
  if (error instanceof AppointmentConflictError) return false;
  if (error instanceof AppointmentWriteStaleError) return false;
  if (error instanceof AppointmentWriteNotFoundError) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|network|fetch|abort|empty response|Failed to fetch/i.test(message);
}

async function readBackPrepared(
  command: PreparedAppointmentMutate,
  persistence: AppointmentMutateHost,
): Promise<ScheduleAppointment | undefined> {
  return persistence.appointments.get(command.organizationId, command.appointmentId);
}

async function reconcileMutate(
  command: PreparedAppointmentMutate,
  persistence: AppointmentMutateHost,
  whenMissing: "stale" | "retryable",
): Promise<ScheduleAppointment> {
  const existing = await readBackPrepared(command, persistence);
  if (!existing) {
    throw new AppointmentWriteNotFoundError();
  }
  if (appointmentMatchesPreparedMutate(existing, command)) {
    return existing;
  }
  if (existing.updatedAt === command.expectedUpdatedAt) {
    if (whenMissing === "retryable") {
      throw new AppointmentWriteRetryableError(
        "Appointment mutate commit state is unknown; retry with the same expectedUpdatedAt",
      );
    }
    throw new AppointmentWriteStaleError();
  }
  throw new AppointmentWriteStaleError();
}

export async function mutateAppointmentSafely(
  command: PreparedAppointmentMutate,
  persistence: AppointmentMutateHost,
): Promise<{ appointment: ScheduleAppointment; outcome: AppointmentSafeMutateOutcome }> {
  if (!command.expectedUpdatedAt?.trim()) {
    throw new Error(APPOINTMENT_EXPECTED_UPDATED_AT_REQUIRED_MESSAGE);
  }
  if (command.customerId == null || command.customerId === "") {
    throw new AppointmentWriteIntegrityError("Appointment mutate is missing customer_id");
  }

  try {
    const updated = await persistence.appointments.update(command.organizationId, command);
    if (updated.id !== command.appointmentId) {
      throw new AppointmentWriteIntegrityError("Update returned a different appointment app id");
    }
    if (updated.customerId !== command.customerId) {
      throw new AppointmentWriteIntegrityError("Update must not change customer_id");
    }
    return { appointment: updated, outcome: "updated" };
  } catch (error) {
    if (error instanceof AppointmentWriteIntegrityError) throw error;
    if (error instanceof AppointmentWriteStaleError) throw error;
    if (error instanceof AppointmentWriteNotFoundError) throw error;
    if (error instanceof AppointmentConflictError) throw error;
    if (isAppointmentExclusionConflictError(error)) {
      throw new AppointmentConflictError();
    }
    if (error instanceof AppointmentWriteZeroRowError) {
      const replayed = await reconcileMutate(command, persistence, "stale");
      return { appointment: replayed, outcome: "replayed" };
    }
    if (isAmbiguousCommitError(error)) {
      const replayed = await reconcileMutate(command, persistence, "retryable");
      return { appointment: replayed, outcome: "replayed" };
    }
    throw error;
  }
}
