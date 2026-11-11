"use server";

import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { STAFF_AUTH_MEMBERSHIPS_TABLE, isStaffAuthRole } from "@/lib/staff-auth/membership-schema";
import {
  authorizeSupervisorPasswordReset,
  validateSupervisorPassword,
} from "@/lib/staff-auth/supervisor-password-reset-policy";

export type SupervisorPasswordResetResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function supervisorSetStaffPasswordAction(input: {
  organizationId: string;
  membershipId: string;
  newPassword: string;
}): Promise<SupervisorPasswordResetResult> {
  const fail = (message: string): SupervisorPasswordResetResult => ({ ok: false, message });
  if (!input || typeof input.organizationId !== "string" ||
      typeof input.membershipId !== "string" || typeof input.newPassword !== "string" ||
      input.organizationId.length > 128 || input.membershipId.length > 128) {
    return fail("請提供有效的員工資料");
  }
  if (!validateSupervisorPassword(input.newPassword)) {
    return fail("密碼需為 12 至 128 字元，且包含英文字母與數字");
  }
  const actor = await getServerStaffAuthUser();
  const resolved = await getAuthenticatedStaffMembership({ organizationId: input.organizationId });
  if (!actor || resolved.status !== "ok") return fail("沒有權限設定員工密碼");
  const admin = createServiceRoleClient();
  if (!admin) return fail("管理員服務尚未設定");

  // Read target from authoritative database, never trust browser-provided role or auth ID.
  const { data: target, error: targetError } = await admin
    .from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .select("id, organization_id, auth_user_id, role, is_active")
    .eq("id", input.membershipId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (targetError || !target) return fail("找不到此員工的正式登入資料");

  if (!isStaffAuthRole(target.role)) return fail("員工角色資料無效");

  const decision = authorizeSupervisorPasswordReset({
    actorAuthUserId: actor.id,
    actorRole: resolved.membership.role,
    actorActive: resolved.membership.isActive,
    actorOrganizationId: resolved.membership.organizationId,
    targetAuthUserId: target.auth_user_id,
    targetRole: target.role,
    targetActive: target.is_active,
    targetOrganizationId: target.organization_id,
  });
  if (!decision.allowed) return fail("無權限修改此員工的密碼，或員工尚未綁定登入帳號");

  // Audit is required before any Auth mutation; if ledger is missing, fail closed.
  const { data: audit, error: auditError } = await admin
    .from("staff_password_reset_audit")
    .insert({
      organization_id: input.organizationId,
      actor_auth_user_id: actor.id,
      target_auth_user_id: target.auth_user_id,
      target_membership_id: target.id,
      status: "attempted",
    })
    .select("id")
    .single();
  if (auditError || !audit) return fail("稽核紀錄無法建立，密碼未變更");

  // Do not log the password or pass it to audit.
  const { error: updateError } = await admin.auth.admin.updateUserById(
    target.auth_user_id,
    { password: input.newPassword },
  );
  const { error: finalizeError } = await admin
    .from("staff_password_reset_audit")
    .update({
      status: updateError ? "failed" : "succeeded",
      completed_at: new Date().toISOString(),
    })
    .eq("id", audit.id)
    .eq("status", "attempted");
  if (finalizeError) {
    // Auth and Postgres cannot share an atomic transaction. The attempted row
    // remains for reconciliation; do not claim success.
    return fail("稽核結果未完成，請管理員檢查紀錄後再操作，勿立即重試");
  }
  if (updateError) return fail("密碼更新失敗，請稍後再試");
  return { ok: true, message: "已設定新密碼，員工可使用新密碼登入" };
}
