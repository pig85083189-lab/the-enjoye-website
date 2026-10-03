import { listMemberships } from "@/lib/staff-auth/membership-query";
import type { StaffRole } from "@/types/saas";

const STAFF_MANAGE_ROLES = new Set<StaffRole>(["OWNER"]);

export function canMembershipManageStaff(
  membership: { role: StaffRole; isActive: boolean } | null | undefined,
): boolean {
  return Boolean(membership?.isActive && STAFF_MANAGE_ROLES.has(membership.role));
}

export function canActorManageStaff(
  organizationId: string,
  actorStaffId: string,
): boolean {
  if (!organizationId || !actorStaffId) return false;
  const membership = listMemberships(organizationId).find(
    (item) => item.userId === actorStaffId && item.isActive,
  );
  return canMembershipManageStaff(membership);
}

export function assertCanManageStaff(
  organizationId: string,
  actorStaffId: string,
): void {
  if (!canActorManageStaff(organizationId, actorStaffId)) {
    throw new Error("沒有權限管理員工");
  }
}
