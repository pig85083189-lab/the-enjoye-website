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
import { evaluateStaffInviteRequest } from "@/lib/staff-auth/staff-invite-command";
import { resolveStaffInviteRedirect } from "@/lib/staff-auth/staff-invite-redirect";

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

  const decision = evaluateStaffInviteRequest({
    invitePilotEnabled,
    inviteSendOpen,
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    email: input.email,
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

  return {
    ok: false,
    reason: "invite_send_closed",
    message: "邀請寄送尚未開放",
  };
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
