/**
 * Recoverable Staff invite decisions.
 * Auth create and PostgreSQL writes are not one transaction — callers must
 * persist an invite row first, then send, then attach. Never delete Auth users.
 */

import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import { normalizeStaffEmail } from "@/lib/staff-auth/email";
import { isInviteExpired, type StaffInviteStatus } from "@/lib/staff-auth/staff-invite-state";

type InviteRef = {
  id: string;
  invitedAuthUserId: string | null;
  status: StaffInviteStatus;
  expiresAt: string;
  createdAt?: string | null;
};

export type StaffInviteAuthUserFacts = {
  id: string;
  email?: string | null;
  emailConfirmedAt?: string | null;
  invitedAt?: string | null;
  createdAt?: string | null;
};

function pendingInvite(invite: InviteRef | null | undefined, now?: Date): InviteRef | null {
  if (!invite?.id.startsWith("inv-")) return null;
  if (invite.status !== "pending") return null;
  if (isInviteExpired(invite.expiresAt, now)) return null;
  return invite;
}

export const AUTH_USER_LIST_PAGE_SIZE = 200;
export const AUTH_USER_LIST_MAX_PAGES = 50;

/** Owner resend / bind window on staff_login_invites.expires_at. */
export const STAFF_INVITE_ROW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Supabase Auth invite/recovery/magic links share Email OTP Expiration.
 * Hosted default is 3600s. This is not the 7-day invite row.
 */
export const SUPABASE_AUTH_EMAIL_LINK_TTL_DEFAULT_SECONDS = 3600;

export function staffInviteDeliverySuccessMessage(): string {
  return "邀請信已寄出。信件連結效期依 Supabase Email OTP Expiration（預設約 1 小時），不是 7 天。若連結過期，請重寄，不要當成已啟用。";
}

export function staffInviteAuthLinkExpiredMessage(): string {
  return "邀請信件連結已過期。系統邀請列可能仍有效，請店長重寄以取得新連結。";
}

export function canAttachLookedUpAuthUserToPendingInvite(input: {
  pendingInvite: InviteRef | null | undefined;
  found: StaffInviteAuthUserFacts | null | undefined;
  now?: Date;
}): boolean {
  const pending = pendingInvite(input.pendingInvite, input.now);
  const found = input.found;
  if (!pending || !found?.id || !isAuthUuid(found.id)) return false;
  if (pending.invitedAuthUserId === found.id) return true;
  if (pending.invitedAuthUserId) return false;
  if (found.emailConfirmedAt) return false;
  const inviteCreated = Date.parse(pending.createdAt ?? "");
  const userCreated = Date.parse(found.invitedAt ?? found.createdAt ?? "");
  if (!Number.isFinite(inviteCreated) || !Number.isFinite(userCreated)) return false;
  return userCreated >= inviteCreated - 5_000;
}

export function interpretInviteAcceptability(input: {
  inviteStatus: StaffInviteStatus;
  inviteExpiresAt: string;
  authLinkExpired: boolean;
  now?: Date;
}):
  | "accept_ok"
  | "auth_link_expired"
  | "invite_expired"
  | "invite_revoked"
  | "invalid" {
  if (input.inviteStatus === "revoked") return "invite_revoked";
  if (input.inviteStatus === "accepted") return "invalid";
  if (input.inviteStatus === "expired" || isInviteExpired(input.inviteExpiresAt, input.now)) {
    return "invite_expired";
  }
  if (input.authLinkExpired) return "auth_link_expired";
  if (input.inviteStatus === "pending") return "accept_ok";
  return "invalid";
}

export type StaffInviteAuthEmailClass =
  | "lookup_failed"
  | "not_found"
  | "bound"
  | "unbound_existing"
  | "pending_invite";

export type StaffInviteDeliveryPlan =
  | {
      ok: false;
      reason: "error" | "conflict" | "invalid_invite";
      message: string;
    }
  | {
      ok: true;
      persistFirst: true;
      sendEmail: boolean;
      reuseInviteId: string | null;
      attachAuthUserId: string | null;
      sendMethod: "invite_new" | "resend_known";
      allowInviteExistingAuthUser: boolean;
    };

export type AuthUserListPage = {
  ok: boolean;
  users: Array<{
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
    invited_at?: string | null;
    created_at?: string | null;
  }>;
};

export function authUserFactsFromListUser(user: {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  invited_at?: string | null;
  created_at?: string | null;
  emailConfirmedAt?: string | null;
  invitedAt?: string | null;
  createdAt?: string | null;
}): StaffInviteAuthUserFacts {
  return {
    id: user.id,
    email: user.email,
    emailConfirmedAt: user.emailConfirmedAt ?? user.email_confirmed_at ?? null,
    invitedAt: user.invitedAt ?? user.invited_at ?? null,
    createdAt: user.createdAt ?? user.created_at ?? null,
  };
}

export function classifyStaffInviteAuthEmail(input: {
  lookupOk: boolean;
  foundAuthUserId: string | null;
  foundAuthUser?: StaffInviteAuthUserFacts | null;
  targetAuthUserId: string | null;
  pendingInvite: InviteRef | null;
  boundMembershipId: string | null;
  now?: Date;
}): StaffInviteAuthEmailClass {
  if (!input.lookupOk) return "lookup_failed";
  const found = input.foundAuthUser ?? (input.foundAuthUserId
    ? { id: input.foundAuthUserId }
    : null);
  if (!found?.id) return "not_found";
  if (input.targetAuthUserId && input.targetAuthUserId === found.id) return "bound";
  if (input.boundMembershipId) return "bound";
  if (
    canAttachLookedUpAuthUserToPendingInvite({
      pendingInvite: input.pendingInvite,
      found,
      now: input.now,
    })
  ) {
    return "pending_invite";
  }
  return "unbound_existing";
}

export function reduceAuthUserListPages(input: {
  email: string;
  pages: AuthUserListPage[];
  pageSize?: number;
  complete: boolean;
}):
  | { ok: false; reason: "lookup_failed"; message: string }
  | { ok: true; authUserId: string | null; user: StaffInviteAuthUserFacts | null } {
  const email = normalizeStaffEmail(input.email);
  if (!input.pages.length) {
    return { ok: false, reason: "lookup_failed", message: "無法確認這個 Email 是否已有登入帳號" };
  }
  for (const page of input.pages) {
    if (!page.ok || !Array.isArray(page.users)) {
      return {
        ok: false,
        reason: "lookup_failed",
        message: "無法確認這個 Email 是否已有登入帳號",
      };
    }
  }
  if (!input.complete) {
    return {
      ok: false,
      reason: "lookup_failed",
      message: "無法確認這個 Email 是否已有登入帳號",
    };
  }
  const pageSize = input.pageSize ?? AUTH_USER_LIST_PAGE_SIZE;
  const last = input.pages[input.pages.length - 1];
  if (last.users.length >= pageSize && input.pages.length >= AUTH_USER_LIST_MAX_PAGES) {
    return {
      ok: false,
      reason: "lookup_failed",
      message: "無法確認這個 Email 是否已有登入帳號",
    };
  }
  for (const page of input.pages) {
    const found = page.users.find(
      (user) => user.email && normalizeStaffEmail(user.email) === email && isAuthUuid(user.id),
    );
    if (found) {
      return {
        ok: true,
        authUserId: found.id,
        user: authUserFactsFromListUser(found),
      };
    }
  }
  return { ok: true, authUserId: null, user: null };
}

export function planStaffInviteDelivery(input: {
  classification: StaffInviteAuthEmailClass;
  foundAuthUserId: string | null;
  foundAuthUser?: StaffInviteAuthUserFacts | null;
  existingInvite: InviteRef | null;
  mode: "invite" | "resend";
  now?: Date;
}): StaffInviteDeliveryPlan {
  if (input.classification === "lookup_failed") {
    return {
      ok: false,
      reason: "error",
      message: "無法確認這個 Email 是否已有登入帳號",
    };
  }
  if (input.classification === "bound") {
    return { ok: false, reason: "conflict", message: "這個 Email 已經有登入帳號" };
  }

  const pending = pendingInvite(input.existingInvite, input.now);
  const pendingId = pending?.id ?? null;
  const found =
    input.foundAuthUser ??
    (input.foundAuthUserId ? { id: input.foundAuthUserId } : null);

  if (input.classification === "pending_invite") {
    if (
      !pendingId ||
      !found?.id ||
      !canAttachLookedUpAuthUserToPendingInvite({
        pendingInvite: pending,
        found,
        now: input.now,
      })
    ) {
      return { ok: false, reason: "invalid_invite", message: "沒有可重寄的邀請" };
    }
    return {
      ok: true,
      persistFirst: true,
      sendEmail: true,
      reuseInviteId: pendingId,
      attachAuthUserId: found.id,
      sendMethod: "resend_known",
      allowInviteExistingAuthUser: false,
    };
  }

  if (input.classification === "unbound_existing") {
    return { ok: false, reason: "conflict", message: "這個 Email 已經有登入帳號" };
  }

  if (input.mode === "resend" && !pendingId) {
    return { ok: false, reason: "invalid_invite", message: "沒有可重寄的邀請" };
  }

  return {
    ok: true,
    persistFirst: true,
    sendEmail: true,
    reuseInviteId: pendingId,
    attachAuthUserId: null,
    sendMethod: "invite_new",
    allowInviteExistingAuthUser: false,
  };
}

export function interpretInviteRowAfterSend(input: {
  sendOk: boolean;
  persistOk: boolean;
  attachOk: boolean;
  authUserId: string | null;
  inviteId: string | null;
}):
  | { ok: true; authUserId: string; inviteId: string }
  | {
      ok: false;
      reason: "error" | "mapping_failed";
      message: string;
      authUserId?: string;
      inviteId?: string;
    } {
  if (input.sendOk && input.persistOk && input.attachOk && input.authUserId && input.inviteId?.startsWith("inv-")) {
    return { ok: true, authUserId: input.authUserId, inviteId: input.inviteId };
  }
  if (input.sendOk && input.authUserId && (!input.persistOk || !input.attachOk)) {
    return {
      ok: false,
      reason: "mapping_failed",
      message: "邀請信已寄出，但邀請紀錄寫入失敗。請重試以接上既有帳號，不要再建立新帳號。",
      authUserId: input.authUserId,
      inviteId: input.inviteId ?? undefined,
    };
  }
  if (input.persistOk && input.inviteId && !input.sendOk) {
    return {
      ok: false,
      reason: "error",
      message: "邀請紀錄已建立，但邀請信寄送失敗。請重試，系統不會再建立第二筆邀請。",
      inviteId: input.inviteId,
      authUserId: input.authUserId ?? undefined,
    };
  }
  return { ok: false, reason: "error", message: "邀請信寄送失敗" };
}

export function evaluateStaffPasswordSetup(input: {
  authenticated: boolean;
  boundActiveMembership: boolean;
  pendingInviteForAuthUser: boolean;
}): "recovery" | "invite" | "unavailable" | "login" {
  if (!input.authenticated) return "login";
  if (input.boundActiveMembership) return "recovery";
  if (input.pendingInviteForAuthUser) return "invite";
  return "unavailable";
}

export function passwordSetupMustNotClaimMembership(
  intent: ReturnType<typeof evaluateStaffPasswordSetup>,
): boolean {
  return intent === "recovery" || intent === "unavailable" || intent === "login";
}

export function interpretPasswordSetupCompletion(input: {
  passwordUpdated: boolean;
  intent: ReturnType<typeof evaluateStaffPasswordSetup>;
  bindOk: boolean;
}): {
  complete: boolean;
  showActivated: boolean;
  message: string;
} {
  if (!input.passwordUpdated) {
    return {
      complete: false,
      showActivated: false,
      message: "目前無法設定密碼",
    };
  }
  if (input.intent === "recovery") {
    return { complete: true, showActivated: true, message: "密碼已設定" };
  }
  if (input.intent === "invite" && input.bindOk) {
    return { complete: true, showActivated: true, message: "密碼已設定" };
  }
  if (input.intent === "invite" && !input.bindOk) {
    return {
      complete: false,
      showActivated: false,
      message: "密碼已儲存，但尚未取得工作台權限",
    };
  }
  return {
    complete: false,
    showActivated: false,
    message: "目前無法完成啟用",
  };
}
