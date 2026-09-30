/**
 * Server membership resolution.
 * Never falls back to staff-001 for an unmatched auth user.
 */
import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { MEMBERSHIP_ENJOYE_OWNER_ID } from "@/lib/tenant/constants";
import { assertOperationalStaffId } from "@/lib/staff-auth/staff-id";
import type { StaffMembership } from "@/types/saas";

export type AuthenticatedStaffMembershipStatus =
  | "unauthenticated"
  | "no_membership"
  | "inactive"
  | "wrong_org"
  | "ok";

export type AuthenticatedStaffMembershipResult =
  | { status: "unauthenticated"; membership: null; memberships: StaffMembership[] }
  | { status: "no_membership"; membership: null; memberships: StaffMembership[] }
  | { status: "inactive"; membership: null; memberships: StaffMembership[] }
  | { status: "wrong_org"; membership: null; memberships: StaffMembership[] }
  | {
      status: "ok";
      membership: StaffMembership;
      memberships: StaffMembership[];
    };

export function applyOwnerBootstrapMemberships(
  memberships: StaffMembership[],
  input: {
    authUserId: string;
    ownerBootstrapAuthUserId?: string | null;
  },
): StaffMembership[] {
  const bootstrap = input.ownerBootstrapAuthUserId?.trim();
  if (!bootstrap || bootstrap !== input.authUserId) return memberships;
  if (memberships.some((item) => item.id === MEMBERSHIP_ENJOYE_OWNER_ID)) {
    return memberships.map((item) =>
      item.id === MEMBERSHIP_ENJOYE_OWNER_ID
        ? { ...item, authUserId: item.authUserId || bootstrap }
        : item,
    );
  }
  const seeded = SEED_MEMBERSHIPS.find((item) => item.id === MEMBERSHIP_ENJOYE_OWNER_ID);
  if (!seeded) return memberships;
  return [
    ...memberships,
    { ...seeded, authUserId: bootstrap },
  ];
}

export function resolveAuthenticatedStaffMembership(input: {
  authUserId: string | null | undefined;
  organizationId?: string | null;
  memberships: StaffMembership[];
  ownerBootstrapAuthUserId?: string | null;
}): AuthenticatedStaffMembershipResult {
  if (!input.authUserId) {
    return { status: "unauthenticated", membership: null, memberships: [] };
  }

  const mapped = applyOwnerBootstrapMemberships(input.memberships, {
    authUserId: input.authUserId,
    ownerBootstrapAuthUserId: input.ownerBootstrapAuthUserId,
  }).filter((item) => item.authUserId === input.authUserId);

  for (const row of mapped) {
    assertOperationalStaffId(row.userId);
  }

  if (mapped.length === 0) {
    return { status: "no_membership", membership: null, memberships: [] };
  }

  if (input.organizationId) {
    const match = mapped.find((item) => item.organizationId === input.organizationId);
    if (!match) {
      return { status: "wrong_org", membership: null, memberships: mapped };
    }
    if (!match.isActive) {
      return { status: "inactive", membership: null, memberships: mapped };
    }
    return { status: "ok", membership: match, memberships: mapped.filter((item) => item.isActive) };
  }

  const active = mapped.filter((item) => item.isActive);
  if (active.length === 0) {
    return { status: "inactive", membership: null, memberships: mapped };
  }
  return { status: "ok", membership: active[0]!, memberships: active };
}

export function operationalUserIdFromResolution(
  result: AuthenticatedStaffMembershipResult,
): string {
  if (result.status !== "ok") return "";
  assertOperationalStaffId(result.membership.userId);
  return result.membership.userId;
}
