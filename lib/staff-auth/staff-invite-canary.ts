/**
 * Preview-only staff invite canary allowlist.
 * This is the send authorization for PR #30 — a global send boolean is not sufficient.
 * Other emails, memberships, resends, Production, and extra send calls are refused.
 */

import { normalizeStaffEmail } from "@/lib/staff-auth/email";
import type {
  StaffInviteRecord,
  StaffInviteRequestMode,
} from "@/lib/staff-auth/staff-invite-command";
import {
  isPreviewSupabaseUrl,
  isProductionSupabaseUrl,
  PREVIEW_SUPABASE_HOST,
} from "@/lib/staff-auth/staff-invite-redirect";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

export const STAFF_INVITE_CANARY_EMAIL = "dog1060330@gmail.com";
export const STAFF_INVITE_CANARY_MEMBERSHIP_ID = "mem-preview-canary-dog1060330";
export const STAFF_INVITE_CANARY_USER_ID = "staff-preview-canary-dog1060330";
export const STAFF_INVITE_CANARY_ORGANIZATION_ID = ORG_ENJOYE_ID;
export const STAFF_INVITE_CANARY_INVITE_ID = "inv-30506ef33d4d4f68";
export const STAFF_INVITE_CANARY_CLAIM_ID = "canary-resend:inv-30506ef33d4d4f68";
export const STAFF_INVITE_CANARY_SUPABASE_REF = "bfzquejrtgqzzarhkiya";
export const CLAIM_STAFF_INVITE_CANARY_SEND_RPC = "claim_staff_invite_canary_send";

const claimedCanarySends = new Set<string>();

export type StaffInviteCanaryDecision =
  | { ok: true }
  | { ok: false; reason: "invite_send_closed"; message: string };

function refuse(message: string): StaffInviteCanaryDecision {
  return { ok: false, reason: "invite_send_closed", message };
}

export function isStaffInviteCanaryEmail(email: string | null | undefined): boolean {
  return normalizeStaffEmail(email ?? "") === STAFF_INVITE_CANARY_EMAIL;
}

export function staffInviteCanaryCreateIds(): {
  membershipId: string;
  userId: string;
} {
  return {
    membershipId: STAFF_INVITE_CANARY_MEMBERSHIP_ID,
    userId: STAFF_INVITE_CANARY_USER_ID,
  };
}

export function canarySendAttemptKey(
  membershipId: string,
  email: string,
): string {
  return `${membershipId}:${normalizeStaffEmail(email)}`;
}

export function hasStaffInviteCanarySendBeenClaimed(
  membershipId: string,
  email: string,
): boolean {
  return claimedCanarySends.has(canarySendAttemptKey(membershipId, email));
}

/** Process-local lock so inviteUserByEmail can run at most once per canary target. */
export function claimStaffInviteCanarySendAttempt(
  membershipId: string,
  email: string,
): boolean {
  const key = canarySendAttemptKey(membershipId, email);
  if (claimedCanarySends.has(key)) return false;
  claimedCanarySends.add(key);
  return true;
}

export function resetStaffInviteCanarySendAttemptsForTests(): void {
  claimedCanarySends.clear();
}

export function evaluateStaffInviteCanarySend(input: {
  env?: NodeJS.Dict<string>;
  email?: string | null;
  membershipId?: string | null;
  organizationId?: string | null;
  userId?: string | null;
  mode?: StaffInviteRequestMode | null;
  existingInvite?: StaffInviteRecord | null;
}): StaffInviteCanaryDecision {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  if ((env.VERCEL_ENV ?? "").trim() === "production") {
    return refuse("邀請寄送尚未開放");
  }
  if (isProductionSupabaseUrl(supabaseUrl)) {
    return refuse("邀請寄送尚未開放");
  }
  if ((env.VERCEL_ENV ?? "").trim() !== "preview") {
    return refuse("邀請寄送尚未開放");
  }
  if (!isPreviewSupabaseUrl(supabaseUrl)) {
    return refuse("邀請寄送尚未開放");
  }
  if (!PREVIEW_SUPABASE_HOST.startsWith(`${STAFF_INVITE_CANARY_SUPABASE_REF}.`)) {
    return refuse("邀請寄送尚未開放");
  }

  if (input.organizationId !== STAFF_INVITE_CANARY_ORGANIZATION_ID) {
    return refuse("此次 Preview 測試僅允許指定的測試員工");
  }
  if (input.membershipId !== STAFF_INVITE_CANARY_MEMBERSHIP_ID) {
    return refuse("此次 Preview 測試僅允許指定的測試員工");
  }
  if (!isStaffInviteCanaryEmail(input.email)) {
    return refuse("此次 Preview 測試僅允許指定的測試員工");
  }
  if (input.userId != null && input.userId !== STAFF_INVITE_CANARY_USER_ID) {
    return refuse("此次 Preview 測試僅允許指定的測試員工");
  }
  if (input.mode === "resend") {
    return refuse("此次 Preview 測試僅允許寄送一封邀請，且不得重寄");
  }
  if (input.existingInvite) {
    return refuse("此次 Preview 測試僅允許寄送一封邀請，且不得重寄");
  }
  if (
    hasStaffInviteCanarySendBeenClaimed(
      STAFF_INVITE_CANARY_MEMBERSHIP_ID,
      STAFF_INVITE_CANARY_EMAIL,
    )
  ) {
    return refuse("此次 Preview 測試僅允許寄送一封邀請，且不得重寄");
  }
  return { ok: true };
}
