/**
 * Server-only Staff invite delivery. Never import from Client Components.
 * Persist the invite row first, then send, then attach.
 * Preview canary resend: Owner-session claim RPC first, skip persist when the
 * pending invite is already attached, then inviteUserByEmail once. Never retry
 * send after a claim. Never delete Auth users. Tokens and passwords are not logged.
 */

import { createServiceRoleClient } from "@/lib/supabase/admin";
import { tryGetSupabaseServiceRoleKey } from "@/lib/supabase/env";
import { extractInvitedAuthUserId } from "@/lib/staff-auth/invite-mapping";
import {
  CREATE_STAFF_LOGIN_INVITE_RPC,
  interpretStaffInviteSendFailure,
  type StaffInviteRecord,
  type StaffInviteRequestMode,
} from "@/lib/staff-auth/staff-invite-command";
import {
  CLAIM_STAFF_INVITE_CANARY_SEND_RPC,
  STAFF_INVITE_CANARY_INVITE_ID,
  STAFF_INVITE_CANARY_RESEND_ONLY_MESSAGE,
  evaluateStaffInviteCanarySend,
  interpretStaffInviteCanaryClaimRpc,
  isExactStaffInviteCanaryPendingResend,
  type StaffInviteCanaryClaimResult,
} from "@/lib/staff-auth/staff-invite-canary";
import { isStaffInviteSendOpen } from "@/lib/staff-auth/staff-invite-flag";
import {
  AUTH_USER_LIST_MAX_PAGES,
  AUTH_USER_LIST_PAGE_SIZE,
  classifyStaffInviteAuthEmail,
  interpretInviteRowAfterSend,
  planStaffInviteDelivery,
  reduceAuthUserListPages,
  STAFF_INVITE_ROW_TTL_MS,
  type StaffInviteAuthUserFacts,
  type StaffInviteDeliveryPlan,
} from "@/lib/staff-auth/staff-invite-reconciliation";
import { createClient } from "@/lib/supabase/server";

export const STAFF_INVITE_TTL_MS = STAFF_INVITE_ROW_TTL_MS;

export type StaffInviteSendResult =
  | { ok: true; authUserId: string; inviteId: string; mode: StaffInviteRequestMode }
  | {
      ok: false;
      reason:
        | "invite_send_closed"
        | "not_configured"
        | "unauthorized"
        | "conflict"
        | "invalid_email"
        | "invalid_invite"
        | "error"
        | "mapping_failed";
      message: string;
      authUserId?: string;
      inviteId?: string;
    };

export type AuthUserListPageFn = (
  page: number,
  perPage: number,
) => Promise<{
  users?: Array<{
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
    invited_at?: string | null;
    created_at?: string | null;
  }>;
  error?: { message?: string } | null;
}>;

export async function lookupAuthUserIdForStaffEmail(
  email: string,
  listPage?: AuthUserListPageFn,
): Promise<
  | { ok: false; reason: "lookup_failed"; message: string }
  | { ok: true; authUserId: string | null; user: StaffInviteAuthUserFacts | null }
> {
  const fetchPage =
    listPage ??
    (async (page: number, perPage: number) => {
      if (typeof window !== "undefined") {
        throw new Error("Staff invite adapter cannot run in the browser");
      }
      const admin = createServiceRoleClient();
      if (!admin) {
        return { error: { message: "not configured" }, users: undefined };
      }
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      return { users: data?.users, error };
    });

  const pages = [];
  for (let page = 1; page <= AUTH_USER_LIST_MAX_PAGES; page += 1) {
    const result = await fetchPage(page, AUTH_USER_LIST_PAGE_SIZE);
    if (result.error || !result.users) {
      return {
        ok: false,
        reason: "lookup_failed",
        message: "無法確認這個 Email 是否已有登入帳號",
      };
    }
    pages.push({ ok: true, users: result.users });
    if (result.users.length < AUTH_USER_LIST_PAGE_SIZE) {
      return reduceAuthUserListPages({
        email,
        pages,
        pageSize: AUTH_USER_LIST_PAGE_SIZE,
        complete: true,
      });
    }
  }
  return reduceAuthUserListPages({
    email,
    pages,
    pageSize: AUTH_USER_LIST_PAGE_SIZE,
    complete: false,
  });
}

export type RecoverableInvitePersistFn = (input: {
  invitedAuthUserId: string | null;
  existingInviteId: string | null;
}) => Promise<{ ok: true; inviteId: string } | { ok: false; message: string }>;

export type RecoverableInviteSendFn = () => Promise<
  | { ok: true; authUserId: string }
  | { ok: false; alreadyRegistered: boolean; message: string }
>;

export async function executeRecoverableStaffInviteDelivery(input: {
  plan: Extract<StaffInviteDeliveryPlan, { ok: true }>;
  mode: StaffInviteRequestMode;
  persist: RecoverableInvitePersistFn;
  sendInviteEmail: RecoverableInviteSendFn;
  skipPersist?: boolean;
}): Promise<StaffInviteSendResult> {
  let inviteId: string;
  if (input.skipPersist) {
    if (!input.plan.reuseInviteId?.startsWith("inv-")) {
      return {
        ok: false,
        reason: "invalid_invite",
        message: "沒有可重寄的邀請",
      };
    }
    inviteId = input.plan.reuseInviteId;
  } else {
    const persisted = await input.persist({
      invitedAuthUserId: input.plan.attachAuthUserId,
      existingInviteId: input.plan.reuseInviteId,
    });
    if (!persisted.ok) {
      return {
        ok: false,
        reason: "error",
        message: "邀請紀錄寫入失敗",
      };
    }
    inviteId = persisted.inviteId;
  }

  let sendOk = !input.plan.sendEmail;
  let authUserId = input.plan.attachAuthUserId;
  if (input.plan.sendEmail) {
    const sent = await input.sendInviteEmail();
    if (sent.ok) {
      authUserId = sent.authUserId;
      sendOk = Boolean(authUserId);
    } else if (sent.alreadyRegistered && input.plan.attachAuthUserId) {
      return {
        ok: false,
        reason: "error",
        message:
          "無法重寄邀請信。這個 Email 已有 Auth 帳號，inviteUserByEmail 不會保證再寄一封。請確認 Auth 支援重邀未完成帳號，或請已綁定帳號使用忘記密碼。",
        authUserId: input.plan.attachAuthUserId,
        inviteId,
      };
    } else if (sent.alreadyRegistered) {
      return {
        ok: false,
        reason: "conflict",
        message: "這個 Email 已經有登入帳號",
        inviteId,
      };
    } else {
      const mapped = interpretStaffInviteSendFailure(sent.message);
      const outcome = interpretInviteRowAfterSend({
        sendOk: false,
        persistOk: true,
        attachOk: false,
        authUserId,
        inviteId,
      });
      if (outcome.ok) {
        return {
          ok: false,
          reason: "error",
          message: "邀請紀錄已建立，但邀請信寄送失敗。請重試，系統不會再建立第二筆邀請。",
          inviteId,
        };
      }
      return {
        ok: false,
        reason: mapped.reason === "conflict" ? "conflict" : outcome.reason,
        message:
          mapped.reason === "conflict"
            ? mapped.message
            : outcome.message,
        authUserId: outcome.authUserId,
        inviteId,
      };
    }
  }

  let attachOk = Boolean(authUserId && input.plan.attachAuthUserId === authUserId);
  if (authUserId && !attachOk && !input.skipPersist) {
    const attached = await input.persist({
      invitedAuthUserId: authUserId,
      existingInviteId: inviteId,
    });
    attachOk = attached.ok;
  }

  const outcome = interpretInviteRowAfterSend({
    sendOk,
    persistOk: true,
    attachOk,
    authUserId,
    inviteId,
  });
  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.reason,
      message: outcome.message,
      authUserId: outcome.authUserId,
      inviteId: outcome.inviteId,
    };
  }
  return {
    ok: true,
    authUserId: outcome.authUserId,
    inviteId: outcome.inviteId,
    mode: input.mode,
  };
}

export async function claimStaffInviteCanarySendFromOwnerSession(): Promise<StaffInviteCanaryClaimResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(CLAIM_STAFF_INVITE_CANARY_SEND_RPC);
  return interpretStaffInviteCanaryClaimRpc({ data, error });
}

export function isStaffInviteCanaryResendPlan(
  plan: Extract<StaffInviteDeliveryPlan, { ok: true }>,
  existingInvite?: StaffInviteRecord | null,
): boolean {
  return (
    plan.sendMethod === "resend_known" &&
    plan.sendEmail &&
    plan.reuseInviteId === STAFF_INVITE_CANARY_INVITE_ID &&
    Boolean(plan.attachAuthUserId) &&
    isExactStaffInviteCanaryPendingResend(existingInvite)
  );
}

export async function executeCanaryStaffInviteResendDelivery(input: {
  plan: Extract<StaffInviteDeliveryPlan, { ok: true }>;
  existingInvite?: StaffInviteRecord | null;
  claim: () => Promise<StaffInviteCanaryClaimResult>;
  sendInviteEmail: RecoverableInviteSendFn;
}): Promise<StaffInviteSendResult> {
  if (!isStaffInviteCanaryResendPlan(input.plan, input.existingInvite)) {
    return {
      ok: false,
      reason: "invite_send_closed",
      message: STAFF_INVITE_CANARY_RESEND_ONLY_MESSAGE,
    };
  }

  const claimed = await input.claim();
  if (!claimed.ok) {
    return {
      ok: false,
      reason: claimed.reason,
      message: claimed.message,
    };
  }

  return executeRecoverableStaffInviteDelivery({
    plan: input.plan,
    mode: "resend",
    skipPersist: true,
    persist: async () => {
      throw new Error("canary resend must not persist a second invite");
    },
    sendInviteEmail: input.sendInviteEmail,
  });
}

export async function persistStaffLoginInviteRow(input: {
  membershipId: string;
  email: string;
  invitedAuthUserId: string | null;
  existingInviteId?: string | null;
}): Promise<{ ok: true; inviteId: string } | { ok: false; message: string }> {
  const expiresAt = new Date(Date.now() + STAFF_INVITE_TTL_MS).toISOString();
  const supabase = await createClient();
  const inserted = await supabase.rpc(CREATE_STAFF_LOGIN_INVITE_RPC, {
    p_membership_id: input.membershipId,
    p_email: input.email,
    p_invited_auth_user_id: input.invitedAuthUserId,
    p_expires_at: expiresAt,
    p_existing_invite_id: input.existingInviteId ?? null,
  });
  if (inserted.error || !inserted.data) {
    return { ok: false, message: inserted.error?.message || "邀請紀錄寫入失敗" };
  }
  const payload = Array.isArray(inserted.data) ? inserted.data[0] : inserted.data;
  const inviteId =
    payload && typeof payload === "object" && "invite_id" in payload
      ? String((payload as { invite_id?: unknown }).invite_id ?? "")
      : "";
  if (!inviteId.startsWith("inv-")) {
    return { ok: false, message: "邀請紀錄寫入失敗" };
  }
  return { ok: true, inviteId };
}

export async function deliverStaffLoginInvite(input: {
  email: string;
  redirectTo: string;
  membershipId: string;
  organizationId: string;
  mode: StaffInviteRequestMode;
  existingInvite?: StaffInviteRecord | null;
  targetAuthUserId?: string | null;
  boundMembershipIdForEmail?: string | null;
}): Promise<StaffInviteSendResult> {
  if (typeof window !== "undefined") {
    throw new Error("Staff invite adapter cannot run in the browser");
  }
  const sendOpen = isStaffInviteSendOpen();
  const canary = evaluateStaffInviteCanarySend({
    email: input.email,
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    mode: input.mode,
    existingInvite: input.existingInvite ?? null,
  });
  if (!canary.ok) {
    return {
      ok: false,
      reason: "invite_send_closed",
      message: sendOpen ? canary.message : canary.message,
    };
  }
  if (!tryGetSupabaseServiceRoleKey()) {
    return {
      ok: false,
      reason: "not_configured",
      message: "登入邀請功能尚未設定",
    };
  }
  const admin = createServiceRoleClient();
  if (!admin) {
    return {
      ok: false,
      reason: "not_configured",
      message: "登入邀請功能尚未設定",
    };
  }

  const lookup = await lookupAuthUserIdForStaffEmail(input.email);
  if (!lookup.ok) {
    return { ok: false, reason: "error", message: lookup.message };
  }
  const classification = classifyStaffInviteAuthEmail({
    lookupOk: true,
    foundAuthUserId: lookup.authUserId,
    foundAuthUser: lookup.user,
    targetAuthUserId: input.targetAuthUserId ?? null,
    pendingInvite: input.existingInvite ?? null,
    boundMembershipId: input.boundMembershipIdForEmail ?? null,
  });
  const plan = planStaffInviteDelivery({
    classification,
    foundAuthUserId: lookup.authUserId,
    foundAuthUser: lookup.user,
    existingInvite: input.existingInvite ?? null,
    mode: input.mode,
  });
  if (!plan.ok) {
    return { ok: false, reason: plan.reason, message: plan.message };
  }

  return executeCanaryStaffInviteResendDelivery({
    plan,
    existingInvite: input.existingInvite ?? null,
    claim: claimStaffInviteCanarySendFromOwnerSession,
    sendInviteEmail: async () => {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
        redirectTo: input.redirectTo,
      });
      if (error) {
        return {
          ok: false,
          alreadyRegistered: /already|registered|exists/i.test(error.message),
          message: error.message,
        };
      }
      const authUserId = extractInvitedAuthUserId({
        userId: data.user?.id,
        identities: data.user?.identities,
      });
      if (!authUserId) {
        return { ok: false, alreadyRegistered: false, message: "邀請信寄送失敗" };
      }
      if (plan.sendMethod === "resend_known" && plan.attachAuthUserId !== authUserId) {
        return {
          ok: false,
          alreadyRegistered: false,
          message: "重寄結果與邀請紀錄的 Auth 帳號不一致",
        };
      }
      return { ok: true, authUserId };
    },
  });
}
