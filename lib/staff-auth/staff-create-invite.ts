/**
 * Owner create → optional login invite. Operational Staff CREATE stays first.
 * Invite send remains fail-closed at the server action.
 */

import { isValidStaffEmail } from "@/lib/staff-auth/email";
import type { StaffOnboardingSubmitPath } from "@/lib/staff/staff-create-surface-derived";
import type { StaffRole } from "@/types/saas";

export function shouldOfferStaffCreateInvite(input: {
  actorRole: StaffRole | undefined;
  submitPath: StaffOnboardingSubmitPath;
}): boolean {
  return input.actorRole === "OWNER" && input.submitPath === "write";
}

export function defaultStaffCreateInviteChecked(input: {
  actorRole: StaffRole | undefined;
  submitPath: StaffOnboardingSubmitPath;
}): boolean {
  return shouldOfferStaffCreateInvite(input);
}

export function validateStaffCreateInviteSelection(input: {
  sendInvite: boolean;
  email: string;
}): string | null {
  if (!input.sendInvite) return null;
  if (!isValidStaffEmail(input.email)) {
    return "寄送登入邀請需要有效的 Email";
  }
  return null;
}

export function formatStaffCreateInviteNotice(input: {
  invite: {
    ok: boolean;
    reason?: string;
    message: string;
  } | null;
}): string {
  if (!input.invite) return "員工已建立";
  if (input.invite.ok) {
    return `員工已建立。${input.invite.message}`;
  }
  if (input.invite.reason === "invite_send_closed") {
    return "員工已建立。登入邀請尚未開放，系統沒有寄信或建立登入帳號。";
  }
  if (input.invite.reason === "pilot_disabled") {
    return "員工已建立。登入邀請功能尚未啟用，系統沒有寄信或建立登入帳號。";
  }
  return `員工已建立。${input.invite.message}`;
}
