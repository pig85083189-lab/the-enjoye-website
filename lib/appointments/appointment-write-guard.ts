/**
 * Application-layer Appointment write-pilot guards.
 * Create and Cancel use the shared operational capabilities.
 * Does not change RLS. RLS remains org membership + location access.
 */

import { canCancelAppointment, canCreateAppointment } from "@/lib/staff-auth/operational-capabilities";

export const APPOINTMENT_WRITE_PILOT_OWNER_ONLY_MESSAGE =
  "Appointment remote write pilot is Owner-only";

export const APPOINTMENT_WRITE_PILOT_DENIED_MESSAGE =
  "Appointment remote create is not allowed for this role";

export const APPOINTMENT_WRITE_PILOT_CANCEL_DENIED_MESSAGE =
  "Appointment remote cancel is not allowed for this role";

export const APPOINTMENT_WRITE_CREATE_ONLY_MESSAGE =
  "Appointment remote write pilot is create-only";

export class AppointmentWritePilotDeniedError extends Error {
  constructor(message = APPOINTMENT_WRITE_PILOT_DENIED_MESSAGE) {
    super(message);
    this.name = "AppointmentWritePilotDeniedError";
  }
}

export class AppointmentWriteCreateOnlyError extends Error {
  constructor(message = APPOINTMENT_WRITE_CREATE_ONLY_MESSAGE) {
    super(message);
    this.name = "AppointmentWriteCreateOnlyError";
  }
}

export type AppointmentWritePilotRole =
  | "OWNER"
  | "MANAGER"
  | "STAFF"
  | "RECEPTIONIST"
  | "ACCOUNTANT"
  | string;

export function isAppointmentWritePilotOwner(role: string | undefined | null): boolean {
  return role === "OWNER";
}

export function isAppointmentWriteCancelRole(
  role: string | undefined | null,
): boolean {
  return canCancelAppointment({ role, isActive: true });
}

export function isAppointmentWriteOperationalRole(
  role: string | undefined | null,
): boolean {
  return canCreateAppointment({ role, isActive: true });
}

export function assertAppointmentWritePilotOwner(
  role: string | undefined | null,
): asserts role is "OWNER" {
  if (!isAppointmentWritePilotOwner(role)) {
    throw new AppointmentWritePilotDeniedError(APPOINTMENT_WRITE_PILOT_OWNER_ONLY_MESSAGE);
  }
}

export function assertAppointmentWriteCancelRole(
  role: string | undefined | null,
): void {
  if (!isAppointmentWriteCancelRole(role)) {
    throw new AppointmentWritePilotDeniedError(
      APPOINTMENT_WRITE_PILOT_CANCEL_DENIED_MESSAGE,
    );
  }
}

export function assertAppointmentWriteOperationalRole(
  role: string | undefined | null,
): void {
  if (!isAppointmentWriteOperationalRole(role)) {
    throw new AppointmentWritePilotDeniedError();
  }
}

export function refuseAppointmentWriteMutation(
  operation: "update" | "reschedule" | "cancel" | "status" | "delete",
): never {
  throw new AppointmentWriteCreateOnlyError(
    `${APPOINTMENT_WRITE_CREATE_ONLY_MESSAGE}: ${operation} is unavailable`,
  );
}
