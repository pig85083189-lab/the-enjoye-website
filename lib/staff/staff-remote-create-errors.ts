export type StaffRemoteCreateFailureReason =
  | "pilot_disabled"
  | "unauthenticated"
  | "unauthorized"
  | "invalid_input"
  | "privilege_denied"
  | "conflict"
  | "auth_failed"
  | "membership_failed"
  | "location_failed"
  | "partial_provisioning";

export class StaffRemoteCreateError extends Error {
  readonly reason: StaffRemoteCreateFailureReason;
  readonly authUserId?: string;
  readonly membershipId?: string;
  readonly cleanupAttempted?: boolean;
  readonly cleanupSucceeded?: boolean;

  constructor(
    reason: StaffRemoteCreateFailureReason,
    message: string,
    extras?: {
      authUserId?: string;
      membershipId?: string;
      cleanupAttempted?: boolean;
      cleanupSucceeded?: boolean;
    },
  ) {
    super(message);
    this.name = "StaffRemoteCreateError";
    this.reason = reason;
    this.authUserId = extras?.authUserId;
    this.membershipId = extras?.membershipId;
    this.cleanupAttempted = extras?.cleanupAttempted;
    this.cleanupSucceeded = extras?.cleanupSucceeded;
  }
}

export function redactStaffRemoteCreateSecret(value: string): string {
  return value.replace(
    /(password|passwd|pwd|secret)\s*[:=]\s*\S+/gi,
    "$1=[redacted]",
  );
}
