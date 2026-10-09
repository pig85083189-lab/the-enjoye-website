/**
 * Owner invite control visibility.
 * UI is not authorization — the server action re-checks flags, send, and Auth lookup.
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

export type StaffInviteLifecycle =
  | "activated"
  | "waiting_activation"
  | "send_failed"
  | "expired"
  | "unbound";

export function canShowStaffInviteStatus(input: {
  actorRole: StaffRole | null;
  actorActive: boolean;
  actorOrganizationId: string | null;
  target: StaffInviteTargetVisibility | null;
}): boolean {
  if (
    !canMembershipManageStaff({
      role: input.actorRole ?? "STAFF",
      isActive: input.actorActive,
    })
  ) {
    return false;
  }
  if (!input.target) return false;
  return input.target.organizationId === input.actorOrganizationId;
}

export function canShowStaffInviteControl(input: {
  invitePilotEnabled: boolean;
  inviteSendOpen: boolean;
  actorRole: StaffRole | null;
  actorActive: boolean;
  actorOrganizationId: string | null;
  target: StaffInviteTargetVisibility | null;
}): boolean {
  void input.invitePilotEnabled;
  void input.inviteSendOpen;
  if (!canShowStaffInviteStatus(input)) return false;
  if (!input.target) return false;
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

export function deriveStaffInviteLifecycle(input: {
  authUserId: string | null;
  invite: {
    status: string;
    expiresAt: string;
    invitedAuthUserId: string | null;
  } | null;
  now?: Date;
}): StaffInviteLifecycle {
  if (input.authUserId) return "activated";
  const invite = input.invite;
  if (!invite) return "unbound";
  if (invite.status === "accepted") return "activated";
  const expired =
    invite.status === "expired" || isInviteExpired(invite.expiresAt, input.now);
  if (expired) return "expired";
  if (invite.status === "pending") {
    return invite.invitedAuthUserId ? "waiting_activation" : "send_failed";
  }
  return "unbound";
}

export function staffInviteLifecycleLabel(lifecycle: StaffInviteLifecycle): string {
  if (lifecycle === "activated") return "已啟用";
  if (lifecycle === "waiting_activation") return "等待啟用";
  if (lifecycle === "send_failed") return "寄送失敗";
  if (lifecycle === "expired") return "邀請已過期";
  return "尚未綁定登入帳號";
}

export function staffInviteSendButtonLabel(lifecycle: StaffInviteLifecycle): string {
  if (lifecycle === "waiting_activation" || lifecycle === "send_failed") {
    return "重寄登入邀請";
  }
  return "寄送登入邀請";
}

export function staffInviteSendMode(
  lifecycle: StaffInviteLifecycle,
): "invite" | "resend" {
  return lifecycle === "waiting_activation" || lifecycle === "send_failed"
    ? "resend"
    : "invite";
}

export function loginBindingFromLifecycle(
  lifecycle: StaffInviteLifecycle,
): "bound" | "unbound" | "pending" {
  if (lifecycle === "activated") return "bound";
  if (lifecycle === "waiting_activation" || lifecycle === "send_failed") {
    return "pending";
  }
  return "unbound";
}

export function staffInviteBindingLabel(
  binding: "bound" | "unbound" | "pending",
): string {
  if (binding === "bound") return "已啟用";
  if (binding === "pending") return "等待啟用";
  return "尚未綁定登入帳號";
}

export function pickLatestStaffInviteForMembership<
  T extends { membershipId: string; status: string; expiresAt: string },
>(invites: readonly T[], membershipId: string, now?: Date): T | null {
  const rows = invites.filter((invite) => invite.membershipId === membershipId);
  return (
    rows.find(
      (invite) => invite.status === "pending" && !isInviteExpired(invite.expiresAt, now),
    ) ??
    rows[0] ??
    null
  );
}
