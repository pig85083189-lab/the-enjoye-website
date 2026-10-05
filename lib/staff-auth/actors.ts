import { listMemberships } from "@/lib/staff-auth/membership-query";
import { canManageStaffCapability } from "@/lib/staff-auth/operational-capabilities";
import type { StaffRole } from "@/types/saas";

export function canMembershipManageStaff(
  membership: { role: StaffRole; isActive: boolean } | null | undefined,
): boolean {
  return canManageStaffCapability(membership);
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
