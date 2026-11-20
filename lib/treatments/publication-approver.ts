import { isAuthUuid } from "@/lib/staff-auth/staff-id";

const PUBLISH_ROLES = new Set(["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"]);

export type BookingStaffMembershipRow = {
  auth_user_id: string | null;
  user_id: string;
  role: string;
  is_active: boolean;
  organization_id: string;
};

/**
 * The finance database has a different Auth project, so its auth.users table
 * cannot prove this login. The booking session user must match one active
 * staff_auth_memberships row. A UUID by itself is not enough.
 * Returns the booking auth user id to store, or null when the check fails.
 */
export function verifiedBookingPublicationApprover(input: {
  sessionUserId: string | null;
  membershipAuthUserId: string | null;
  membershipUserId: string | null;
  organizationId: string;
  rows: readonly BookingStaffMembershipRow[];
}): string | null {
  const sessionUserId = input.sessionUserId?.trim() ?? "";
  const membershipAuthUserId = input.membershipAuthUserId?.trim() ?? "";
  const membershipUserId = input.membershipUserId?.trim() ?? "";
  if (!isAuthUuid(sessionUserId) || sessionUserId.toLowerCase() !== membershipAuthUserId.toLowerCase()) return null;
  if (!membershipUserId || isAuthUuid(membershipUserId)) return null;
  const matches = input.rows.filter((row) =>
    row.organization_id === input.organizationId &&
    row.is_active === true &&
    PUBLISH_ROLES.has(row.role) &&
    (row.auth_user_id ?? "").toLowerCase() === sessionUserId.toLowerCase() &&
    row.user_id === membershipUserId
  );
  if (matches.length !== 1) return null;
  return sessionUserId;
}
