/**
 * DB contract for Strategy B StaffMembership persistence.
 * Same StaffMembership domain type — not a second store.
 */
import type { StaffMembership, StaffRole } from "@/types/saas";
import { assertOperationalStaffId, isAuthUuid } from "@/lib/staff-auth/staff-id";

export const STAFF_AUTH_MEMBERSHIPS_TABLE = "staff_auth_memberships";
export const STAFF_AUTH_MEMBERSHIP_LOCATIONS_TABLE =
  "staff_auth_membership_locations";

export const STAFF_AUTH_ROLES: StaffRole[] = [
  "OWNER",
  "MANAGER",
  "STAFF",
  "RECEPTIONIST",
  "ACCOUNTANT",
];

export type StaffAuthMembershipRow = {
  id: string;
  user_id: string;
  auth_user_id: string | null;
  organization_id: string;
  role: string;
  display_name: string;
  email: string | null;
  phone?: string | null;
  title?: string | null;
  is_active: boolean;
  created_at: string;
  created_by_staff_id?: string | null;
};

export type StaffAuthMembershipLocationRow = {
  membership_id: string;
  location_id: string;
};

export function isStaffAuthRole(value: string): value is StaffRole {
  return STAFF_AUTH_ROLES.includes(value as StaffRole);
}

export function assertNoPasswordField(record: Record<string, unknown>): void {
  const keys = Object.keys(record).map((key) => key.toLowerCase());
  if (keys.some((key) => key.includes("password") || key === "pwd" || key === "secret")) {
    throw new Error("password must never be persisted on StaffMembership");
  }
}

export function uniquenessAuthOrg(
  authUserId: string,
  organizationId: string,
): string {
  return `${authUserId}::${organizationId}`;
}

export function uniquenessOrgUser(organizationId: string, userId: string): string {
  return `${organizationId}::${userId}`;
}

export function staffMembershipFromRow(
  row: StaffAuthMembershipRow,
  locationIds: string[],
): StaffMembership {
  assertNoPasswordField(row as unknown as Record<string, unknown>);
  if (!isStaffAuthRole(row.role)) {
    throw new Error("role is not a canonical StaffRole");
  }
  assertOperationalStaffId(row.user_id);
  if (isAuthUuid(row.user_id)) {
    throw new Error("auth UUID must not be used as operational staffId");
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    authUserId: row.auth_user_id,
    email: row.email,
    locationIds,
    role: row.role,
    displayName: row.display_name,
    phone: row.phone ?? null,
    title: row.title ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export function staffMembershipToRow(
  membership: StaffMembership,
): StaffAuthMembershipRow {
  assertNoPasswordField(membership as unknown as Record<string, unknown>);
  assertOperationalStaffId(membership.userId);
  if (!isStaffAuthRole(membership.role)) {
    throw new Error("role is not a canonical StaffRole");
  }
  return {
    id: membership.id,
    user_id: membership.userId,
    auth_user_id: membership.authUserId ?? null,
    organization_id: membership.organizationId,
    role: membership.role,
    display_name: membership.displayName,
    email: membership.email ?? null,
    phone: membership.phone ?? null,
    title: membership.title ?? null,
    is_active: membership.isActive,
    created_at: membership.createdAt,
  };
}

export function staffMembershipLocationRows(
  membership: StaffMembership,
): StaffAuthMembershipLocationRow[] {
  return [...new Set(membership.locationIds)].map((locationId) => ({
    membership_id: membership.id,
    location_id: locationId,
  }));
}
