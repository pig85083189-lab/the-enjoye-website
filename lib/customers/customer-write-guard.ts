/**
 * Application-layer guard for the Customer remote-create pilot.
 * Create-only. Does not change RLS (org membership).
 */

export const CUSTOMER_WRITE_CREATE_ONLY_MESSAGE =
  "Customer remote write pilot is create-only";

export const CUSTOMER_WRITE_PILOT_OFF_MESSAGE =
  "Customer remote write pilot is off";

export class CustomerWriteCreateOnlyError extends Error {
  constructor(message = CUSTOMER_WRITE_CREATE_ONLY_MESSAGE) {
    super(message);
    this.name = "CustomerWriteCreateOnlyError";
  }
}

export class CustomerWritePilotOffError extends Error {
  constructor(message = CUSTOMER_WRITE_PILOT_OFF_MESSAGE) {
    super(message);
    this.name = "CustomerWritePilotOffError";
  }
}

export class CustomerDuplicateError extends Error {
  readonly existingIds: string[];

  constructor(existingIds: string[]) {
    super("A customer with this phone already exists in the organization");
    this.name = "CustomerDuplicateError";
    this.existingIds = existingIds;
  }
}

export function refuseCustomerWriteMutation(kind: string): never {
  throw new CustomerWriteCreateOnlyError(`${CUSTOMER_WRITE_CREATE_ONLY_MESSAGE} (${kind})`);
}
