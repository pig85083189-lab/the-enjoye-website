/**
 * Preview-only staff invite canary allowlist.
 * This is the send authorization for PR #30 — a global send boolean is not sufficient.
 * Other emails, memberships, Production, invite_new, and extra send calls are refused.
 * One-time send is enforced by public.claim_staff_invite_canary_send(), not process memory.
 */

import { normalizeStaffEmail } from "@/lib/staff-auth/email";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import type {
  StaffInviteRecord,
  StaffInviteRequestMode,
} from "@/lib/staff-auth/staff-invite-command";
import {
  isPreviewSupabaseUrl,
  isProductionSupabaseUrl,
  PREVIEW_SUPABASE_HOST,
} from "@/lib/staff-auth/staff-invite-redirect";
import { isInviteExpired } from "@/lib/staff-auth/staff-invite-state";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

export const STAFF_INVITE_CANARY_EMAIL = "dog1060330@gmail.com";
export const STAFF_INVITE_CANARY_MEMBERSHIP_ID = "mem-preview-canary-dog1060330";
export const STAFF_INVITE_CANARY_USER_ID = "staff-preview-canary-dog1060330";
export const STAFF_INVITE_CANARY_ORGANIZATION_ID = ORG_ENJOYE_ID;
export const STAFF_INVITE_CANARY_INVITE_ID = "inv-30506ef33d4d4f68";
export const STAFF_INVITE_CANARY_CLAIM_ID = "canary-resend:inv-30506ef33d4d4f68";
export const STAFF_INVITE_CANARY_SUPABASE_REF = "bfzquejrtgqzzarhkiya";
export const CLAIM_STAFF_INVITE_CANARY_SEND_RPC = "claim_staff_invite_canary_send";

export const STAFF_INVITE_CANARY_ALREADY_CLAIMED_MESSAGE =
  "此次 Preview 測試僅允許寄送一封邀請，且不得重寄";
export const STAFF_INVITE_CANARY_TARGET_MESSAGE =
  "此次 Preview 測試僅允許指定的測試員工";
export const STAFF_INVITE_CANARY_RESEND_ONLY_MESSAGE =
  "此次 Preview 測試僅允許重寄指定邀請";

export type StaffInviteCanaryDecision =
  | { ok: true }
  | { ok: false; reason: "invite_send_closed"; message: string };

export type StaffInviteCanaryClaimResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invite_send_closed"
        | "unauthorized"
        | "conflict"
        | "invalid_invite"
        | "error";
      message: string;
    };

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

export function isExactStaffInviteCanaryPendingResend(
  invite: StaffInviteRecord | null | undefined,
  now?: Date,
): boolean {
  if (!invite) return false;
  if (invite.id !== STAFF_INVITE_CANARY_INVITE_ID) return false;
  if (invite.membershipId !== STAFF_INVITE_CANARY_MEMBERSHIP_ID) return false;
  if (invite.organizationId !== STAFF_INVITE_CANARY_ORGANIZATION_ID) return false;
  if (normalizeStaffEmail(invite.email) !== STAFF_INVITE_CANARY_EMAIL) return false;
  if (invite.status !== "pending") return false;
  if (isInviteExpired(invite.expiresAt, now)) return false;
  if (!invite.invitedAuthUserId || !isAuthUuid(invite.invitedAuthUserId)) return false;
  return true;
}

export function evaluateStaffInviteCanarySend(input: {
  env?: NodeJS.Dict<string>;
  email?: string | null;
  membershipId?: string | null;
  organizationId?: string | null;
  userId?: string | null;
  mode?: StaffInviteRequestMode | null;
  existingInvite?: StaffInviteRecord | null;
  now?: Date;
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
    return refuse(STAFF_INVITE_CANARY_TARGET_MESSAGE);
  }
  if (input.membershipId !== STAFF_INVITE_CANARY_MEMBERSHIP_ID) {
    return refuse(STAFF_INVITE_CANARY_TARGET_MESSAGE);
  }
  if (!isStaffInviteCanaryEmail(input.email)) {
    return refuse(STAFF_INVITE_CANARY_TARGET_MESSAGE);
  }
  if (input.userId != null && input.userId !== STAFF_INVITE_CANARY_USER_ID) {
    return refuse(STAFF_INVITE_CANARY_TARGET_MESSAGE);
  }
  if (!isExactStaffInviteCanaryPendingResend(input.existingInvite, input.now)) {
    return refuse(STAFF_INVITE_CANARY_RESEND_ONLY_MESSAGE);
  }
  return { ok: true };
}

export function interpretStaffInviteCanaryClaimRpc(input: {
  data: unknown;
  error?: { message?: string; code?: string } | null;
}): StaffInviteCanaryClaimResult {
  const error = input.error;
  if (error) {
    const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
    if (
      text.includes("42501") ||
      text.includes("unauthorized") ||
      text.includes("not authenticated")
    ) {
      return { ok: false, reason: "unauthorized", message: "沒有權限邀請員工登入" };
    }
    if (text.includes("already bound") || text.includes("23505")) {
      return { ok: false, reason: "conflict", message: "這位員工已經綁定登入帳號" };
    }
    if (
      text.includes("already_claimed") ||
      text.includes("unique") ||
      text.includes("already claimed")
    ) {
      return {
        ok: false,
        reason: "invite_send_closed",
        message: STAFF_INVITE_CANARY_ALREADY_CLAIMED_MESSAGE,
      };
    }
    if (
      text.includes("expired") ||
      text.includes("invalid invite") ||
      text.includes("invalid membership") ||
      text.includes("22023")
    ) {
      return { ok: false, reason: "invalid_invite", message: "沒有可重寄的邀請" };
    }
    return { ok: false, reason: "error", message: "無法取得寄送授權" };
  }

  const payload = Array.isArray(input.data) ? input.data[0] : input.data;
  if (payload && typeof payload === "object") {
    const row = payload as { ok?: unknown; reason?: unknown; message?: unknown };
    if (row.ok === true) return { ok: true };
    if (row.reason === "already_claimed") {
      return {
        ok: false,
        reason: "invite_send_closed",
        message:
          typeof row.message === "string" && row.message
            ? row.message
            : STAFF_INVITE_CANARY_ALREADY_CLAIMED_MESSAGE,
      };
    }
  }
  return { ok: false, reason: "error", message: "無法取得寄送授權" };
}
