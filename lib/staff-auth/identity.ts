/**
 * Strategy B identity resolution.
 * auth.users.id → StaffMembership.authUserId → StaffMembership.userId (staff-xxx)
 */
import { CURRENT_ORG_STORAGE_KEY } from "@/lib/tenant/constants";
import {
  assertOperationalStaffId,
  listMembershipsForAuthUser,
} from "@/lib/staff-auth/membership-query";
import { getStaffAuthUserId } from "@/lib/staff-auth/session";
import type { StaffMembership } from "@/types/saas";

export function resolveActiveMembershipsForAuthUser(
  authUserId: string | null | undefined,
): StaffMembership[] {
  if (!authUserId) return [];
  return listMembershipsForAuthUser(authUserId, { activeOnly: true });
}

export function resolveOperationalUserId(input: {
  authUserId: string | null | undefined;
  organizationId?: string | null;
  activeOnly?: boolean;
}): string {
  if (!input.authUserId) return "";
  const rows = listMembershipsForAuthUser(input.authUserId, {
    activeOnly: input.activeOnly !== false,
  });
  if (rows.length === 0) return "";
  if (input.organizationId) {
    const match = rows.find((row) => row.organizationId === input.organizationId);
    if (!match) return "";
    assertOperationalStaffId(match.userId);
    return match.userId;
  }
  assertOperationalStaffId(rows[0]!.userId);
  return rows[0]!.userId;
}

/**
 * Operational staff identity for the current Auth user.
 * Never returns an auth UUID. Never falls back to staff-001.
 */
export function getCurrentUserId(): string {
  const authId = getStaffAuthUserId();
  if (!authId) return "";
  const storedOrg =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(CURRENT_ORG_STORAGE_KEY);
  const scoped = resolveOperationalUserId({
    authUserId: authId,
    organizationId: storedOrg,
  });
  if (scoped) return scoped;
  return resolveOperationalUserId({ authUserId: authId });
}

export function operationalStaffIdFromMembership(
  membership: Pick<StaffMembership, "userId" | "id">,
): string {
  assertOperationalStaffId(membership.userId);
  if (membership.userId === membership.id) {
    throw new Error("membership.id must not be used as staffId");
  }
  return membership.userId;
}
