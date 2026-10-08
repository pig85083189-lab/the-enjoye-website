"use server";

import { getStaffInviteCapability } from "@/lib/staff-auth/invite-capability";
import {
  getAuthenticatedStaffMembership,
  getServerStaffAuthUser,
  loadServerMembershipsForAuthUser,
  persistServerStaffMembership,
} from "@/lib/staff-auth/server";
import { tryGetSupabaseServiceRoleKey } from "@/lib/supabase/env";
import { canMembershipManageStaff } from "@/lib/staff-auth/actors";
import type { StaffMembership } from "@/types/saas";
import { createLiveStaffRemoteProvisionDeps } from "@/lib/staff/staff-remote-create-adapter";
import type { StaffRemoteCreateDraft } from "@/lib/staff/staff-remote-create-command";
import { StaffRemoteCreateError } from "@/lib/staff/staff-remote-create-errors";
import { isStaffRemoteCreatePilotEnabled } from "@/lib/staff/staff-remote-create-flag";
import { runAuthenticatedStaffRemoteCreate } from "@/lib/staff/staff-remote-create-pilot";
import type { StaffRemoteCreatePublicMembership } from "@/lib/staff/staff-remote-provision";
import {
  isStaffInvitePilotEnabled,
  isStaffInviteSendOpen,
} from "@/lib/staff-auth/staff-invite-flag";
import {
  BIND_INVITED_STAFF_AUTH_USER_RPC,
  REVOKE_STAFF_LOGIN_INVITE_RPC,
  evaluateStaffInviteBind,
  evaluateStaffInviteRequest,
  evaluateStaffInviteRevoke,
  type StaffInviteDecisionReason,
  type StaffInviteRecord,
  type StaffInviteRequestMode,
} from "@/lib/staff-auth/staff-invite-command";
import { resolveStaffInviteRedirect } from "@/lib/staff-auth/staff-invite-redirect";
import { deliverStaffLoginInvite } from "@/lib/staff-auth/staff-invite-send-adapter";
import {
  loadOrganizationStaffInvites,
  loadPendingStaffInviteForAuthUser,
  loadStaffInviteForMembership,
  loadStaffInviteTargetByMembershipId,
} from "@/lib/staff-auth/staff-invite-load";
import { createClient } from "@/lib/supabase/server";

export async function getStaffInviteCapabilityAction() {
  return getStaffInviteCapability({
    invitePilotEnabled: isStaffInvitePilotEnabled(),
    inviteSendOpen: isStaffInviteSendOpen(),
    serviceRoleKey: tryGetSupabaseServiceRoleKey(),
  });
}

export async function listMyStaffMembershipsAction(): Promise<StaffMembership[]> {
  const user = await getServerStaffAuthUser();
  if (!user) return [];
  return loadServerMembershipsForAuthUser(user.id);
}

export type PersistStaffMembershipResult =
  | { ok: true; membership: StaffMembership }
  | { ok: false; message: string };

export async function persistStaffMembershipAction(
  membership: StaffMembership,
): Promise<PersistStaffMembershipResult> {
  const resolved = await getAuthenticatedStaffMembership({
    organizationId: membership.organizationId,
  });
  if (resolved.status === "unauthenticated") {
    return { ok: false, message: "請先登入後再儲存員工" };
  }
  if (resolved.status !== "ok") {
    return { ok: false, message: "沒有權限管理員工" };
  }
  if (!canMembershipManageStaff(resolved.membership)) {
    return { ok: false, message: "沒有權限管理員工" };
  }
  if (!tryGetSupabaseServiceRoleKey()) {
    return { ok: false, message: "登入對應尚未設定，請聯絡系統管理員。" };
  }
  try {
    const saved = await persistServerStaffMembership(membership);
    return { ok: true, membership: saved };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "無法寫入員工登入對應",
    };
  }
}

export type InviteStaffLoginResult =
  | { ok: true; authUserId: string }
  | {
      ok: false;
      reason:
        | "pilot_disabled"
        | "not_configured"
        | "unauthorized"
        | "invalid_email"
        | "conflict"
        | "invite_send_closed"
        | "cross_environment"
        | "invalid_invite"
        | "expired"
        | "error"
        | "mapping_failed";
      message: string;
      authUserId?: string;
    };

export async function inviteStaffLoginAction(input: {
  email?: string;
  redirectTo?: string;
  membershipId?: string;
  organizationId?: string;
  mode?: StaffInviteRequestMode;
}): Promise<InviteStaffLoginResult> {
  void input.redirectTo;
  const env =
    typeof process !== "undefined" ? process.env : ({} as NodeJS.Dict<string>);
  const invitePilotEnabled = isStaffInvitePilotEnabled(env);
  const inviteSendOpen = isStaffInviteSendOpen(env);

  if (!invitePilotEnabled) {
    return {
      ok: false,
      reason: "pilot_disabled",
      message: "登入邀請功能尚未啟用",
    };
  }

  if (!input.organizationId || !input.membershipId) {
    return {
      ok: false,
      reason: "unauthorized",
      message: "缺少員工或分店識別，無法邀請",
    };
  }

  const actorUser = await getServerStaffAuthUser();
  const resolved = await getAuthenticatedStaffMembership({
    organizationId: input.organizationId,
  });
  const roster =
    resolved.status === "ok" || resolved.status === "wrong_org"
      ? resolved.memberships
      : [];
  const target =
    roster.find((row) => row.id === input.membershipId) ??
    (await loadTargetMembership(input.organizationId, input.membershipId));
  const existingInvite = await loadStaffInviteForMembership(
    input.membershipId,
    input.organizationId,
  );

  const decision = evaluateStaffInviteRequest({
    invitePilotEnabled,
    inviteSendOpen,
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    email: input.email,
    mode: input.mode,
    actor: {
      authUserId: actorUser?.id ?? null,
      role: resolved.status === "ok" ? resolved.membership.role : null,
      isActive: resolved.status === "ok" ? resolved.membership.isActive : false,
      organizationId: resolved.status === "ok" ? resolved.membership.organizationId : null,
      userId: resolved.status === "ok" ? resolved.membership.userId : null,
    },
    target: target
      ? {
          id: target.id,
          organizationId: target.organizationId,
          userId: target.userId,
          email: target.email ?? null,
          isActive: target.isActive,
          authUserId: target.authUserId ?? null,
        }
      : null,
    existingInvite,
  });

  if (!decision.ok) {
    return {
      ok: false,
      reason: decision.reason,
      message: decision.message,
    };
  }

  const redirect = resolveStaffInviteRedirect(env, input.redirectTo);
  if (!redirect.ok) {
    return {
      ok: false,
      reason: redirect.reason === "cross_environment" ? "cross_environment" : "error",
      message: redirect.message,
    };
  }

  if (!inviteSendOpen) {
    return {
      ok: false,
      reason: "invite_send_closed",
      message: "邀請寄送尚未開放",
    };
  }

  const sent = await deliverStaffLoginInvite({
    email: decision.email,
    redirectTo: redirect.redirectTo,
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    mode: decision.mode,
    existingInviteId: existingInvite?.id ?? null,
  });
  if (!sent.ok) {
    return {
      ok: false,
      reason: sent.reason,
      message: sent.message,
    };
  }
  return { ok: true, authUserId: sent.authUserId };
}

export type AcceptStaffInviteResult =
  | { ok: true; membershipId: string }
  | {
      ok: false;
      reason: StaffInviteDecisionReason | "error";
      message: string;
    };

export async function acceptStaffInviteAction(): Promise<AcceptStaffInviteResult> {
  const user = await getServerStaffAuthUser();
  if (!user) {
    return { ok: false, reason: "unauthorized", message: "請先開啟邀請連結" };
  }
  const invite = await loadPendingStaffInviteForAuthUser(user.id);
  const membership = invite
    ? await loadStaffInviteTargetByMembershipId(invite.membershipId, invite.organizationId)
    : null;
  const decision = evaluateStaffInviteBind({
    invite,
    membership,
    actorAuthUserId: user.id,
    actorEmail: user.email,
  });
  if (!decision.ok) {
    return {
      ok: false,
      reason: decision.reason,
      message: decision.message,
    };
  }
  const supabase = await createClient();
  const bound = await supabase.rpc(BIND_INVITED_STAFF_AUTH_USER_RPC, {
    p_invite_id: decision.inviteId,
  });
  if (bound.error) {
    return {
      ok: false,
      reason: "error",
      message: "目前無法完成登入綁定",
    };
  }
  return { ok: true, membershipId: decision.membershipId };
}

export type RevokeStaffInviteResult =
  | { ok: true; inviteId: string }
  | {
      ok: false;
      reason: StaffInviteDecisionReason;
      message: string;
    };

export async function revokeStaffLoginInviteAction(input: {
  inviteId?: string;
  organizationId?: string;
}): Promise<RevokeStaffInviteResult> {
  const env =
    typeof process !== "undefined" ? process.env : ({} as NodeJS.Dict<string>);
  const actorUser = await getServerStaffAuthUser();
  const resolved = await getAuthenticatedStaffMembership({
    organizationId: input.organizationId,
  });
  const invites =
    resolved.status === "ok"
      ? await loadOrganizationStaffInvites(resolved.membership.organizationId)
      : [];
  const invite = invites.find((row) => row.id === input.inviteId) ?? null;
  const decision = evaluateStaffInviteRevoke({
    invitePilotEnabled: isStaffInvitePilotEnabled(env),
    actor: {
      authUserId: actorUser?.id ?? null,
      role: resolved.status === "ok" ? resolved.membership.role : null,
      isActive: resolved.status === "ok" ? resolved.membership.isActive : false,
      organizationId: resolved.status === "ok" ? resolved.membership.organizationId : null,
      userId: resolved.status === "ok" ? resolved.membership.userId : null,
    },
    invite: invite ?? null,
  });
  if (!decision.ok) {
    return {
      ok: false,
      reason: decision.reason,
      message: decision.message,
    };
  }
  const supabase = await createClient();
  const revoked = await supabase.rpc(REVOKE_STAFF_LOGIN_INVITE_RPC, {
    p_invite_id: decision.inviteId,
  });
  if (revoked.error) {
    return { ok: false, reason: "error", message: "目前無法撤銷邀請" };
  }
  return { ok: true, inviteId: decision.inviteId };
}

export async function listStaffLoginInvitesAction(
  organizationId?: string,
): Promise<StaffInviteRecord[]> {
  if (!organizationId) return [];
  const resolved = await getAuthenticatedStaffMembership({ organizationId });
  if (resolved.status !== "ok") return [];
  return loadOrganizationStaffInvites(resolved.membership.organizationId);
}

async function loadTargetMembership(
  organizationId: string,
  membershipId: string,
): Promise<StaffMembership | null> {
  const user = await getServerStaffAuthUser();
  if (!user) return null;
  const rows = await loadServerMembershipsForAuthUser(user.id);
  return (
    rows.find(
      (row) => row.id === membershipId && row.organizationId === organizationId,
    ) ?? null
  );
}

export type ProvisionStaffEmployeeResult =
  | { ok: true; membership: StaffRemoteCreatePublicMembership }
  | {
      ok: false;
      reason: StaffRemoteCreateError["reason"];
      message: string;
      reconciliation?: boolean;
    };

export async function provisionStaffEmployeeAction(
  draft: StaffRemoteCreateDraft,
): Promise<ProvisionStaffEmployeeResult> {
  if (!isStaffRemoteCreatePilotEnabled()) {
    return {
      ok: false,
      reason: "pilot_disabled",
      message: "遠端員工建立尚未啟用",
    };
  }
  try {
    const membership = await runAuthenticatedStaffRemoteCreate(
      draft,
      createLiveStaffRemoteProvisionDeps(),
    );
    return { ok: true, membership };
  } catch (error) {
    if (error instanceof StaffRemoteCreateError) {
      return {
        ok: false,
        reason: error.reason,
        message: error.message,
        reconciliation: error.reason === "partial_provisioning",
      };
    }
    return {
      ok: false,
      reason: "auth_failed",
      message: "員工建立失敗",
    };
  }
}
