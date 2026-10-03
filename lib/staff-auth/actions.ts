"use server";

import { getStaffInviteCapability } from "@/lib/staff-auth/invite-capability";
import {
  bindServerStaffMembershipAuthUser,
  getAuthenticatedStaffMembership,
  getServerStaffAuthUser,
  loadServerMembershipsForAuthUser,
  persistServerStaffMembership,
} from "@/lib/staff-auth/server";
import { extractInvitedAuthUserId } from "@/lib/staff-auth/invite-mapping";
import { isValidStaffEmail, normalizeStaffEmail } from "@/lib/staff-auth/email";
import { tryGetSupabaseServiceRoleKey } from "@/lib/supabase/env";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { canMembershipManageStaff } from "@/lib/staff-auth/actors";
import type { StaffMembership } from "@/types/saas";
import { createLiveStaffRemoteProvisionDeps } from "@/lib/staff/staff-remote-create-adapter";
import type { StaffRemoteCreateDraft } from "@/lib/staff/staff-remote-create-command";
import { StaffRemoteCreateError } from "@/lib/staff/staff-remote-create-errors";
import { isStaffRemoteCreatePilotEnabled } from "@/lib/staff/staff-remote-create-flag";
import { runAuthenticatedStaffRemoteCreate } from "@/lib/staff/staff-remote-create-pilot";
import type { StaffRemoteCreatePublicMembership } from "@/lib/staff/staff-remote-provision";

export async function getStaffInviteCapabilityAction() {
  return getStaffInviteCapability({
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
        | "not_configured"
        | "unauthorized"
        | "invalid_email"
        | "error"
        | "mapping_failed";
      message: string;
      authUserId?: string;
    };

export async function inviteStaffLoginAction(input: {
  email: string;
  redirectTo: string;
  membershipId?: string;
  organizationId?: string;
}): Promise<InviteStaffLoginResult> {
  const capability = getStaffInviteCapability({
    serviceRoleKey: tryGetSupabaseServiceRoleKey(),
  });
  if (!capability.configured) {
    return { ok: false, reason: "not_configured", message: capability.message };
  }

  const actor = await getServerStaffAuthUser();
  if (!actor) {
    return {
      ok: false,
      reason: "unauthorized",
      message: "請先登入後再邀請員工",
    };
  }

  if (input.organizationId) {
    const resolved = await getAuthenticatedStaffMembership({
      organizationId: input.organizationId,
    });
    if (
      resolved.status !== "ok" ||
      !canMembershipManageStaff(resolved.membership)
    ) {
      return {
        ok: false,
        reason: "unauthorized",
        message: "沒有權限管理員工",
      };
    }
  }

  if (!isValidStaffEmail(input.email)) {
    return {
      ok: false,
      reason: "invalid_email",
      message: "請輸入有效的 Email",
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

  const email = normalizeStaffEmail(input.email);
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: input.redirectTo,
  });

  const authUserId = extractInvitedAuthUserId({
    userId: data.user?.id,
    identities: data.user?.identities ?? null,
  });

  if (error || !authUserId) {
    return {
      ok: false,
      reason: "error",
      message: error?.message || "邀請寄送失敗",
    };
  }

  if (input.membershipId) {
    try {
      await bindServerStaffMembershipAuthUser(input.membershipId, authUserId);
    } catch (bindError) {
      return {
        ok: false,
        reason: "mapping_failed",
        authUserId,
        message:
          bindError instanceof Error
            ? `邀請已寄出，但登入綁定失敗：${bindError.message}`
            : "邀請已寄出，但登入綁定失敗",
      };
    }
  }

  return { ok: true, authUserId };
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
