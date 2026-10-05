/**
 * In-memory StaffMembership persistence used by tests and as the adapter
 * contract for the Supabase table. Not a second staff / employee store.
 */
import type { StaffMembership } from "@/types/saas";
import {
  staffMembershipFromRow,
  staffMembershipLocationRows,
  staffMembershipToRow,
  uniquenessAuthOrg,
  uniquenessOrgUser,
} from "@/lib/staff-auth/membership-schema";
import { assertOperationalStaffId } from "@/lib/staff-auth/staff-id";

export interface StaffAuthMembershipStore {
  upsert(membership: StaffMembership): StaffMembership;
  bindAuthUser(membershipId: string, authUserId: string): StaffMembership;
  deactivate(membershipId: string): StaffMembership;
  delete(membershipId: string): void;
  listByAuthUserId(authUserId: string): StaffMembership[];
  listByOrganizationId(organizationId: string): StaffMembership[];
  getById(membershipId: string): StaffMembership | undefined;
}

export class StaffAuthMembershipConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffAuthMembershipConflictError";
  }
}

export function createMemoryStaffAuthMembershipStore(
  initial: StaffMembership[] = [],
): StaffAuthMembershipStore {
  const byId = new Map<string, StaffMembership>();

  function write(membership: StaffMembership): StaffMembership {
    assertOperationalStaffId(membership.userId);
    const row = staffMembershipToRow(membership);
    const locations = staffMembershipLocationRows(membership).map(
      (item) => item.location_id,
    );
    const next = staffMembershipFromRow(row, locations);

    const orgUser = uniquenessOrgUser(next.organizationId, next.userId);
    for (const existing of byId.values()) {
      if (existing.id === next.id) continue;
      if (uniquenessOrgUser(existing.organizationId, existing.userId) === orgUser) {
        throw new StaffAuthMembershipConflictError(
          "duplicate (organization_id, user_id)",
        );
      }
      if (
        next.authUserId &&
        existing.authUserId &&
        uniquenessAuthOrg(existing.authUserId, existing.organizationId) ===
          uniquenessAuthOrg(next.authUserId, next.organizationId)
      ) {
        throw new StaffAuthMembershipConflictError(
          "duplicate (auth_user_id, organization_id)",
        );
      }
    }
    byId.set(next.id, cloneMembership(next));
    return cloneMembership(next);
  }

  for (const row of initial) {
    write(row);
  }

  return {
    upsert(membership) {
      const current = byId.get(membership.id);
      return write({
        ...current,
        ...membership,
        id: membership.id,
        userId: current?.userId ?? membership.userId,
        organizationId: current?.organizationId ?? membership.organizationId,
      });
    },
    bindAuthUser(membershipId, authUserId) {
      const current = byId.get(membershipId);
      if (!current) throw new Error("Staff membership not found");
      return write({ ...current, authUserId });
    },
    deactivate(membershipId) {
      const current = byId.get(membershipId);
      if (!current) throw new Error("Staff membership not found");
      return write({ ...current, isActive: false });
    },
    delete(membershipId) {
      if (membershipId === "mem-enjoye-owner") {
        throw new StaffAuthMembershipConflictError("不得刪除現有店主");
      }
      byId.delete(membershipId);
    },
    listByAuthUserId(authUserId) {
      if (!authUserId) return [];
      return [...byId.values()]
        .filter((item) => item.authUserId === authUserId)
        .map(cloneMembership);
    },
    listByOrganizationId(organizationId) {
      return [...byId.values()]
        .filter((item) => item.organizationId === organizationId)
        .map(cloneMembership);
    },
    getById(membershipId) {
      const row = byId.get(membershipId);
      return row ? cloneMembership(row) : undefined;
    },
  };
}

function cloneMembership(row: StaffMembership): StaffMembership {
  return { ...row, locationIds: [...row.locationIds] };
}
