/** Fail-closed policy for supervisor-initiated staff password changes. */
export type PasswordResetRole = "OWNER" | "MANAGER" | "STAFF" | "RECEPTIONIST" | "ACCOUNTANT";
export type PasswordResetDecision =
  | { allowed: true }
  | { allowed: false; reason: "unauthenticated" | "inactive_actor" | "invalid_target" | "self_reset" | "forbidden_role" | "cross_organization" | "inactive_target" | "unbound_target" };

export function authorizeSupervisorPasswordReset(input: {
  actorAuthUserId: string | null;
  actorRole: PasswordResetRole | null;
  actorActive: boolean;
  actorOrganizationId: string | null;
  targetAuthUserId: string | null;
  targetRole: PasswordResetRole;
  targetActive: boolean;
  targetOrganizationId: string;
}): PasswordResetDecision {
  if (!input.actorAuthUserId) return { allowed: false, reason: "unauthenticated" };
  if (!input.actorActive) return { allowed: false, reason: "inactive_actor" };
  if (!input.targetAuthUserId) return { allowed: false, reason: "unbound_target" };
  if (input.actorOrganizationId !== input.targetOrganizationId) return { allowed: false, reason: "cross_organization" };
  if (input.actorAuthUserId === input.targetAuthUserId) return { allowed: false, reason: "self_reset" };
  if (!input.targetActive) return { allowed: false, reason: "inactive_target" };
  if (input.actorRole !== "OWNER" && input.actorRole !== "MANAGER") return { allowed: false, reason: "forbidden_role" };
  // Only owners may reset manager credentials; no supervisor may reset an owner.
  if (input.targetRole === "OWNER" || (input.targetRole === "MANAGER" && input.actorRole !== "OWNER")) {
    return { allowed: false, reason: "forbidden_role" };
  }
  return { allowed: true };
}

export function validateSupervisorPassword(password: string): boolean {
  return password.length >= 12 && password.length <= 128 &&
    /[A-Za-z]/.test(password) && /[0-9]/.test(password) &&
    !/[\u0000-\u001f\u007f]/.test(password);
}
