/**
 * Owner invite control visibility. Default is hidden.
 * UI is not authorization — the server action re-checks every request.
 */

import { isValidStaffEmail, normalizeStaffEmail } from "@/lib/staff-auth/email";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import { canMembershipManageStaff } from "@/lib/staff-auth/actors";
import type { StaffRole } from "@/types/saas";
import type { StaffInviteRecord } from "@/lib/staff-auth/staff-invite-command";
import { isInviteExpired } from "@/lib/staff-auth/staff-invite-state";

export type StaffInviteTargetVisibility = {
  membershipId: string;
  organizationId: string;
  userId: string;
  email: string | null;
  isActive: boolean;
  authUserId: string | null;
};

export function canShowStaffInviteControl(input: {
  invitePilotEnabled: boolean;
  inviteSendOpen: boolean;
  actorRole: StaffRole | null;
  actorActive: boolean;
  actorOrganizationId: string | null;
  target: StaffInviteTargetVisibility | null;
}): boolean {
  if (!input.invitePilotEnabled || !input.inviteSendOpen) return false;
  if (
    !canMembershipManageStaff({
      role: input.actorRole ?? "STAFF",
      isActive: input.actorActive,
    })
  ) {
    return false;
  }
  if (!input.target) return false;
  if (input.target.organizationId !== input.actorOrganizationId) return false;
  if (!input.target.isActive) return false;
  if (input.target.authUserId) return false;
  if (isAuthUuid(input.target.userId)) return false;
  const email = input.target.email ? normalizeStaffEmail(input.target.email) : "";
  return isValidStaffEmail(email);
}

export function canShowStaffInviteRevokeControl(input: {
  invitePilotEnabled: boolean;
  actorRole: StaffRole | null;
  actorActive: boolean;
  actorOrganizationId: string | null;
  invite: StaffInviteRecord | null;
  now?: Date;
}): boolean {
  if (!input.invitePilotEnabled) return false;
  if (
    !canMembershipManageStaff({
      role: input.actorRole ?? "STAFF",
      isActive: input.actorActive,
    })
  ) {
    return false;
  }
  if (!input.invite) return false;
  if (input.invite.organizationId !== input.actorOrganizationId) return false;
  if (input.invite.status !== "pending") return false;
  return !isInviteExpired(input.invite.expiresAt, input.now);
}

export function staffInviteBindingLabel(
  binding: "bound" | "unbound" | "pending",
): string {
  if (binding === "bound") return "已綁定登入帳號";
  if (binding === "pending") return "登入邀請處理中";
  return "尚未綁定登入帳號";
}
