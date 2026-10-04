export const TREATMENT_WRITE_STALE_MESSAGE =
  "Treatment was updated by another write; refresh and retry";

export const TREATMENT_WRITE_NOT_FOUND_MESSAGE = "Treatment not found";

export const TREATMENT_WRITE_ZERO_ROW_MESSAGE =
  "Treatment optimistic update affected zero rows";

export const TREATMENT_CUSTOMER_IMMUTABLE_MESSAGE =
  "Treatment customer_id is immutable";

export const TREATMENT_APPOINTMENT_IMMUTABLE_MESSAGE =
  "Treatment appointment_id is immutable";

export const TREATMENT_LOCATION_IMMUTABLE_MESSAGE =
  "Treatment location_id is immutable";

export const TREATMENT_COMPLETED_IMMUTABLE_MESSAGE =
  "Completed treatment cannot be overwritten by autosave";

export const TREATMENT_EXPECTED_UPDATED_AT_REQUIRED_MESSAGE =
  "Treatment mutation requires expectedUpdatedAt";

export const TREATMENT_DUPLICATE_APPOINTMENT_MESSAGE =
  "A treatment already exists for this appointment";

export const TREATMENT_INSERT_ONLY_MESSAGE =
  "Treatment already exists; insert-only (no upsert)";

export class TreatmentWriteStaleError extends Error {
  constructor(message = TREATMENT_WRITE_STALE_MESSAGE) {
    super(message);
    this.name = "TreatmentWriteStaleError";
  }
}

export class TreatmentWriteNotFoundError extends Error {
  constructor(message = TREATMENT_WRITE_NOT_FOUND_MESSAGE) {
    super(message);
    this.name = "TreatmentWriteNotFoundError";
  }
}

export class TreatmentWriteZeroRowError extends Error {
  constructor(message = TREATMENT_WRITE_ZERO_ROW_MESSAGE) {
    super(message);
    this.name = "TreatmentWriteZeroRowError";
  }
}

export class TreatmentCustomerImmutableError extends Error {
  constructor(message = TREATMENT_CUSTOMER_IMMUTABLE_MESSAGE) {
    super(message);
    this.name = "TreatmentCustomerImmutableError";
  }
}

export class TreatmentAppointmentImmutableError extends Error {
  constructor(message = TREATMENT_APPOINTMENT_IMMUTABLE_MESSAGE) {
    super(message);
    this.name = "TreatmentAppointmentImmutableError";
  }
}

export class TreatmentLocationImmutableError extends Error {
  constructor(message = TREATMENT_LOCATION_IMMUTABLE_MESSAGE) {
    super(message);
    this.name = "TreatmentLocationImmutableError";
  }
}

export class TreatmentCompletedImmutableError extends Error {
  constructor(message = TREATMENT_COMPLETED_IMMUTABLE_MESSAGE) {
    super(message);
    this.name = "TreatmentCompletedImmutableError";
  }
}

export class TreatmentDuplicateError extends Error {
  constructor(message = TREATMENT_DUPLICATE_APPOINTMENT_MESSAGE) {
    super(message);
    this.name = "TreatmentDuplicateError";
  }
}
