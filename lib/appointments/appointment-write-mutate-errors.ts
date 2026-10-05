/**
 * Canonical remote Appointment mutate errors.
 * Stale / not-found / zero-row are mutate-only; overlap still uses AppointmentConflictError.
 */

export const APPOINTMENT_WRITE_STALE_MESSAGE =
  "Appointment was updated by another write; refresh and retry";

export const APPOINTMENT_WRITE_NOT_FOUND_MESSAGE = "Appointment not found";

export const APPOINTMENT_WRITE_ZERO_ROW_MESSAGE =
  "Appointment optimistic update affected zero rows";

export const APPOINTMENT_CUSTOMER_IMMUTABLE_MESSAGE =
  "Appointment customer_id is immutable";

export const APPOINTMENT_EXPECTED_UPDATED_AT_REQUIRED_MESSAGE =
  "Appointment mutation requires expectedUpdatedAt";

export const APPOINTMENT_ALLOW_CONFLICT_REFUSED_MESSAGE =
  "Remote appointment mutation does not allow allowConflict";

export class AppointmentWriteStaleError extends Error {
  constructor(message = APPOINTMENT_WRITE_STALE_MESSAGE) {
    super(message);
    this.name = "AppointmentWriteStaleError";
  }
}

export class AppointmentWriteNotFoundError extends Error {
  constructor(message = APPOINTMENT_WRITE_NOT_FOUND_MESSAGE) {
    super(message);
    this.name = "AppointmentWriteNotFoundError";
  }
}

export class AppointmentWriteZeroRowError extends Error {
  constructor(message = APPOINTMENT_WRITE_ZERO_ROW_MESSAGE) {
    super(message);
    this.name = "AppointmentWriteZeroRowError";
  }
}

export class AppointmentCustomerImmutableError extends Error {
  constructor(message = APPOINTMENT_CUSTOMER_IMMUTABLE_MESSAGE) {
    super(message);
    this.name = "AppointmentCustomerImmutableError";
  }
}
