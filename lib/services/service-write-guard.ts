/**
 * Application-layer guard for the Service remote-create pilot.
 * Create-only. Does not change RLS (org membership).
 * OWNER / MANAGER authorization is enforced in the write runner.
 */

export const SERVICE_WRITE_CREATE_ONLY_MESSAGE =
  "Service remote write pilot is create-only";

export const SERVICE_WRITE_PILOT_OFF_MESSAGE =
  "Service remote write pilot is off";

export const SERVICE_WRITE_UNAUTHORIZED_MESSAGE =
  "Unauthorized to manage services";

export class ServiceWriteCreateOnlyError extends Error {
  constructor(message = SERVICE_WRITE_CREATE_ONLY_MESSAGE) {
    super(message);
    this.name = "ServiceWriteCreateOnlyError";
  }
}

export class ServiceWritePilotOffError extends Error {
  constructor(message = SERVICE_WRITE_PILOT_OFF_MESSAGE) {
    super(message);
    this.name = "ServiceWritePilotOffError";
  }
}

export class ServiceWriteUnauthorizedError extends Error {
  constructor(message = SERVICE_WRITE_UNAUTHORIZED_MESSAGE) {
    super(message);
    this.name = "ServiceWriteUnauthorizedError";
  }
}

export function refuseServiceWriteMutation(kind: string): never {
  throw new ServiceWriteCreateOnlyError(`${SERVICE_WRITE_CREATE_ONLY_MESSAGE} (${kind})`);
}
