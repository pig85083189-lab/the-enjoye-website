/**
 * Application-layer Owner-only guard for a future Appointment write pilot.
 * Does not change RLS. RLS remains org membership + location access.
 */

export const APPOINTMENT_WRITE_PILOT_OWNER_ONLY_MESSAGE =
  "Appointment remote write pilot is Owner-only";

export const APPOINTMENT_WRITE_CREATE_ONLY_MESSAGE =
  "Appointment remote write pilot is create-only";

export class AppointmentWritePilotDeniedError extends Error {
  constructor(message = APPOINTMENT_WRITE_PILOT_OWNER_ONLY_MESSAGE) {
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

export function assertAppointmentWritePilotOwner(
  role: string | undefined | null,
): asserts role is "OWNER" {
  if (!isAppointmentWritePilotOwner(role)) {
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
