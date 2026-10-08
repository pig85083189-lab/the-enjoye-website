/**
 * Pure Staff invite / late-bind security decisions.
 * Server actions must call these before any Auth or RPC side effect.
 */

import { isValidStaffEmail, normalizeStaffEmail } from "@/lib/staff-auth/email";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import {
  isInviteExpired,
  transitionStaffInviteStatus,
  type StaffInviteStatus,
} from "@/lib/staff-auth/staff-invite-state";
import { canMembershipManageStaff } from "@/lib/staff-auth/actors";
import type { StaffRole } from "@/types/saas";
import type { StaffInviteAuthEmailClass } from "@/lib/staff-auth/staff-invite-reconciliation";

export const BIND_INVITED_STAFF_AUTH_USER_RPC = "bind_invited_staff_auth_user";
export const CREATE_STAFF_LOGIN_INVITE_RPC = "create_staff_login_invite";
export const REVOKE_STAFF_LOGIN_INVITE_RPC = "revoke_staff_login_invite";

export type StaffInviteActor = {
  authUserId: string | null;
  role: StaffRole | null;
  isActive: boolean;
  organizationId: string | null;
  userId: string | null;
};

export type StaffInviteTarget = {
  id: string;
  organizationId: string;
  userId: string;
  email: string | null;
  isActive: boolean;
  authUserId: string | null;
};

export type StaffInviteRecord = {
  id: string;
  membershipId: string;
  organizationId: string;
  email: string;
  invitedAuthUserId: string | null;
  status: StaffInviteStatus;
  expiresAt: string;
};

export type StaffInviteDecisionReason =
  | "pilot_disabled"
  | "unauthorized"
  | "invalid_email"
  | "conflict"
  | "invite_send_closed"
  | "invalid_invite"
  | "expired"
  | "error";

export type StaffInviteRequestMode = "invite" | "resend";

export type StaffInviteRequestDecision =
  | { ok: true; email: string; mode: StaffInviteRequestMode }
  | { ok: false; reason: StaffInviteDecisionReason; message: string };

export type StaffInviteBindDecision =
  | { ok: true; membershipId: string; authUserId: string; inviteId: string }
  | { ok: false; reason: StaffInviteDecisionReason; message: string };

export type StaffInviteRevokeDecision =
  | { ok: true; inviteId: string }
  | { ok: false; reason: StaffInviteDecisionReason; message: string };

function refuse(
  reason: StaffInviteDecisionReason,
  message: string,
): { ok: false; reason: StaffInviteDecisionReason; message: string } {
  return { ok: false, reason, message };
}

export function evaluateStaffInviteRequest(input: {
  invitePilotEnabled: boolean;
  inviteSendOpen: boolean;
  organizationId?: string | null;
  membershipId?: string | null;
  email?: string | null;
  actor: StaffInviteActor;
  target: StaffInviteTarget | null;
  existingAuthUserIdForEmail?: string | null;
  existingInvite?: StaffInviteRecord | null;
  authEmailClass?: StaffInviteAuthEmailClass;
  mode?: StaffInviteRequestMode;
  now?: Date;
}): StaffInviteRequestDecision {
  if (!input.invitePilotEnabled) {
    return refuse("pilot_disabled", "登入邀請功能尚未啟用");
  }
  if (!input.organizationId || !input.membershipId) {
    return refuse("unauthorized", "缺少員工或分店識別，無法邀請");
  }
  if (!input.actor.authUserId || !isAuthUuid(input.actor.authUserId)) {
    return refuse("unauthorized", "請先登入後再邀請員工");
  }
  if (
    !input.actor.isActive ||
    input.actor.organizationId !== input.organizationId ||
    !canMembershipManageStaff({
      role: input.actor.role ?? "STAFF",
      isActive: input.actor.isActive,
    })
  ) {
    return refuse("unauthorized", "沒有權限邀請員工登入");
  }
  if (!input.target) {
    return refuse("unauthorized", "找不到員工");
  }
  if (input.target.id !== input.membershipId) {
    return refuse("unauthorized", "找不到員工");
  }
  if (input.target.organizationId !== input.organizationId) {
    return refuse("unauthorized", "不能邀請其他店家的員工");
  }
  if (!input.target.isActive) {
    return refuse("unauthorized", "停用員工不能邀請登入");
  }
  if (input.target.authUserId) {
    return refuse("conflict", "這位員工已經綁定登入帳號");
  }
  if (isAuthUuid(input.target.userId)) {
    return refuse("unauthorized", "員工識別不合法");
  }
  const email = normalizeStaffEmail(input.email ?? "");
  if (!isValidStaffEmail(email)) {
    return refuse("invalid_email", "請輸入有效的 Email");
  }
  const targetEmail = input.target.email ? normalizeStaffEmail(input.target.email) : "";
  if (!targetEmail || targetEmail !== email) {
    return refuse("invalid_email", "邀請 Email 必須與員工資料一致");
  }
  if (input.authEmailClass === "lookup_failed") {
    return refuse("error", "無法確認這個 Email 是否已有登入帳號");
  }
  if (input.authEmailClass === "bound" || input.authEmailClass === "unbound_existing") {
    const pending = resolveUsableInvite(input.existingInvite, input.now);
    const ours =
      input.authEmailClass === "unbound_existing" &&
      pending?.status === "pending" &&
      (!pending.invitedAuthUserId ||
        pending.invitedAuthUserId === input.existingAuthUserIdForEmail);
    if (!ours) {
      return refuse("conflict", "這個 Email 已經有登入帳號");
    }
  }
  if (
    !input.authEmailClass &&
    input.existingAuthUserIdForEmail &&
    input.existingAuthUserIdForEmail !== input.target.authUserId
  ) {
    return refuse("conflict", "這個 Email 已經有登入帳號");
  }
  const requestedMode = input.mode === "resend" ? "resend" : "invite";
  const existing = resolveUsableInvite(input.existingInvite, input.now);
  const samePending =
    existing?.status === "pending" &&
    existing.membershipId === input.membershipId &&
    existing.organizationId === input.organizationId &&
    normalizeStaffEmail(existing.email) === email;
  const mode: StaffInviteRequestMode =
    requestedMode === "invite" && samePending ? "resend" : requestedMode;
  if (mode === "resend") {
    if (!existing || existing.status !== "pending") {
      return refuse("invalid_invite", "沒有可重寄的邀請");
    }
    if (existing.membershipId !== input.membershipId) {
      return refuse("unauthorized", "找不到員工");
    }
    if (existing.organizationId !== input.organizationId) {
      return refuse("unauthorized", "不能邀請其他店家的員工");
    }
    if (normalizeStaffEmail(existing.email) !== email) {
      return refuse("invalid_email", "邀請 Email 必須與員工資料一致");
    }
  } else if (existing) {
    if (existing.status === "pending") {
      return refuse("conflict", "這位員工已有待處理的登入邀請");
    }
    if (existing.status === "accepted") {
      return refuse("conflict", "這位員工已經接受登入邀請");
    }
  }
  if (!input.inviteSendOpen) {
    return refuse("invite_send_closed", "邀請寄送尚未開放");
  }
  return { ok: true, email, mode };
}

export function evaluateStaffInviteBind(input: {
  invite: StaffInviteRecord | null;
  membership: StaffInviteTarget | null;
  actorAuthUserId: string | null;
  actorEmail: string | null;
  now?: Date;
}): StaffInviteBindDecision {
  if (!input.invite?.id.startsWith("inv-")) {
    return refuse("invalid_invite", "邀請不存在");
  }
  if (!input.actorAuthUserId || !isAuthUuid(input.actorAuthUserId)) {
    return refuse("unauthorized", "請先開啟邀請連結");
  }
  if (!input.invite.invitedAuthUserId || input.invite.invitedAuthUserId !== input.actorAuthUserId) {
    return refuse("unauthorized", "這個邀請不屬於目前帳號");
  }
  if (!input.membership || input.membership.id !== input.invite.membershipId) {
    return refuse("invalid_invite", "找不到員工");
  }
  if (input.membership.organizationId !== input.invite.organizationId) {
    return refuse("unauthorized", "不能認領其他店家的員工");
  }
  if (!input.membership.isActive) {
    return refuse("unauthorized", "停用員工不能綁定登入");
  }
  if (input.membership.authUserId) {
    return refuse("conflict", "這位員工已經綁定登入帳號");
  }
  if (isAuthUuid(input.membership.userId)) {
    return refuse("unauthorized", "員工識別不合法");
  }
  const inviteEmail = normalizeStaffEmail(input.invite.email);
  const membershipEmail = input.membership.email
    ? normalizeStaffEmail(input.membership.email)
    : "";
  const actorEmail = input.actorEmail ? normalizeStaffEmail(input.actorEmail) : "";
  if (!inviteEmail || inviteEmail !== membershipEmail || inviteEmail !== actorEmail) {
    return refuse("invalid_email", "邀請 Email 與登入帳號不一致");
  }
  const transition = transitionStaffInviteStatus({
    status: input.invite.status,
    event: "accept",
    expiresAt: input.invite.expiresAt,
    now: input.now,
  });
  if (!transition.ok) {
    return refuse(
      transition.reason === "expired" ? "expired" : "invalid_invite",
      transition.reason === "expired" ? "邀請已過期" : "邀請已失效",
    );
  }
  if (isInviteExpired(input.invite.expiresAt, input.now)) {
    return refuse("expired", "邀請已過期");
  }
  return {
    ok: true,
    membershipId: input.membership.id,
    authUserId: input.actorAuthUserId,
    inviteId: input.invite.id,
  };
}

export function evaluateStaffInviteRevoke(input: {
  invitePilotEnabled: boolean;
  actor: StaffInviteActor;
  invite: StaffInviteRecord | null;
  now?: Date;
}): StaffInviteRevokeDecision {
  if (!input.invitePilotEnabled) {
    return refuse("pilot_disabled", "登入邀請功能尚未啟用");
  }
  if (!input.actor.authUserId || !isAuthUuid(input.actor.authUserId)) {
    return refuse("unauthorized", "請先登入後再撤銷邀請");
  }
  if (
    !input.actor.isActive ||
    !input.actor.organizationId ||
    !canMembershipManageStaff({
      role: input.actor.role ?? "STAFF",
      isActive: input.actor.isActive,
    })
  ) {
    return refuse("unauthorized", "沒有權限撤銷邀請");
  }
  if (!input.invite?.id.startsWith("inv-")) {
    return refuse("invalid_invite", "邀請不存在");
  }
  if (input.invite.organizationId !== input.actor.organizationId) {
    return refuse("unauthorized", "不能撤銷其他店家的邀請");
  }
  const usable = resolveUsableInvite(input.invite, input.now);
  if (!usable || usable.status !== "pending") {
    return refuse("invalid_invite", "沒有可撤銷的邀請");
  }
  const transition = transitionStaffInviteStatus({
    status: usable.status,
    event: "revoke",
    expiresAt: usable.expiresAt,
    now: input.now,
  });
  if (!transition.ok) {
    return refuse(
      transition.reason === "expired" ? "expired" : "invalid_invite",
      transition.reason === "expired" ? "邀請已過期" : "邀請已失效",
    );
  }
  return { ok: true, inviteId: usable.id };
}

export function resolveUsableInvite(
  invite: StaffInviteRecord | null | undefined,
  now?: Date,
): StaffInviteRecord | null {
  if (!invite?.id.startsWith("inv-")) return null;
  if (invite.status === "pending" && isInviteExpired(invite.expiresAt, now)) {
    return { ...invite, status: "expired" };
  }
  return invite;
}

export function interpretStaffInviteSendFailure(message: string): {
  reason: Extract<StaffInviteDecisionReason, "conflict" | "invalid_email" | "error">;
  message: string;
} {
  const text = message.trim();
  if (/already|registered|exists/i.test(text)) {
    return { reason: "conflict", message: "這個 Email 已經有登入帳號" };
  }
  if (/invalid.*(email|user)/i.test(text)) {
    return { reason: "invalid_email", message: "請輸入有效的 Email" };
  }
  return { reason: "error", message: "邀請信寄送失敗" };
}
