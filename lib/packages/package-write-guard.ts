/**
 * Application-layer guard for the Package remote-create pilot.
 * Create-only for package_definitions. Does not change RLS (org membership).
 * OWNER / MANAGER authorization is enforced in the write runner.
 */

export const PACKAGE_WRITE_CREATE_ONLY_MESSAGE =
  "Package remote write pilot is create-only";

export const PACKAGE_WRITE_PILOT_OFF_MESSAGE =
  "Package remote write pilot is off";

export const PACKAGE_WRITE_UNAUTHORIZED_MESSAGE =
  "Unauthorized to manage package definitions";

export class PackageWriteCreateOnlyError extends Error {
  constructor(message = PACKAGE_WRITE_CREATE_ONLY_MESSAGE) {
    super(message);
    this.name = "PackageWriteCreateOnlyError";
  }
}

export class PackageWritePilotOffError extends Error {
  constructor(message = PACKAGE_WRITE_PILOT_OFF_MESSAGE) {
    super(message);
    this.name = "PackageWritePilotOffError";
  }
}

export class PackageWriteUnauthorizedError extends Error {
  constructor(message = PACKAGE_WRITE_UNAUTHORIZED_MESSAGE) {
    super(message);
    this.name = "PackageWriteUnauthorizedError";
  }
}

export function refusePackageWriteMutation(kind: string): never {
  throw new PackageWriteCreateOnlyError(`${PACKAGE_WRITE_CREATE_ONLY_MESSAGE} (${kind})`);
}
