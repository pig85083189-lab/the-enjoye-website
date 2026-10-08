/**
 * Server-controlled Staff login-invite state machine.
 * Claim identity is the invite row, not email or user_metadata.
 */

export const STAFF_INVITE_STATUSES = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const;

export type StaffInviteStatus = (typeof STAFF_INVITE_STATUSES)[number];

export type StaffInviteEvent = "accept" | "revoke" | "expire";

export type StaffInviteTransitionResult =
  | { ok: true; status: StaffInviteStatus }
  | { ok: false; reason: "invalid_transition" | "expired"; status: StaffInviteStatus };

export function isStaffInviteStatus(value: string): value is StaffInviteStatus {
  return (STAFF_INVITE_STATUSES as readonly string[]).includes(value);
}

export function isInviteExpired(expiresAt: string, now: Date = new Date()): boolean {
  const expires = Date.parse(expiresAt);
  return !Number.isFinite(expires) || expires <= now.getTime();
}

export function pendingInviteMembershipIds(
  invites: Array<{ membershipId: string; status: StaffInviteStatus; expiresAt: string }>,
  now: Date = new Date(),
): string[] {
  return invites
    .filter((invite) => invite.status === "pending" && !isInviteExpired(invite.expiresAt, now))
    .map((invite) => invite.membershipId);
}

export function transitionStaffInviteStatus(input: {
  status: StaffInviteStatus;
  event: StaffInviteEvent;
  expiresAt: string;
  now?: Date;
}): StaffInviteTransitionResult {
  const now = input.now ?? new Date();
  if (input.status === "pending" && isInviteExpired(input.expiresAt, now)) {
    if (input.event === "expire") {
      return { ok: true, status: "expired" };
    }
    return { ok: false, reason: "expired", status: "expired" };
  }

  if (input.status === "pending" && input.event === "accept") {
    return { ok: true, status: "accepted" };
  }
  if (input.status === "pending" && input.event === "revoke") {
    return { ok: true, status: "revoked" };
  }
  if (input.status === "pending" && input.event === "expire") {
    return { ok: true, status: "expired" };
  }

  return { ok: false, reason: "invalid_transition", status: input.status };
}
