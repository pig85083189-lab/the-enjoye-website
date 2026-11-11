"use server";

import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { STAFF_AUTH_MEMBERSHIPS_TABLE, isStaffAuthRole } from "@/lib/staff-auth/membership-schema";
import { lookupAuthUserIdForStaffEmail } from "@/lib/staff-auth/staff-invite-send-adapter";
import { classifyBindingRecovery } from "@/lib/staff-auth/staff-provision-recovery";
import { validateSupervisorPassword } from "@/lib/staff-auth/supervisor-password-reset-policy";

export async function supervisorProvisionStaffLoginAction(input: {
  organizationId: string; membershipId: string; email: string; newPassword: string;
}): Promise<{ok: boolean; message: string}> {
  const fail = (message: string) => ({ok: false, message});
  if (!input || typeof input.organizationId !== "string" || typeof input.membershipId !== "string" ||
    typeof input.email !== "string" || typeof input.newPassword !== "string" ||
    input.organizationId.length > 128 || input.membershipId.length > 128) return fail("資料格式不正確");
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("請輸入有效 Email");
  if (!validateSupervisorPassword(input.newPassword)) return fail("密碼需為 12 至 128 字元，包含英文字母及數字");
  const actor = await getServerStaffAuthUser();
  const resolved = await getAuthenticatedStaffMembership({organizationId: input.organizationId});
  if (!actor || resolved.status !== "ok") return fail("沒有權限開通員工帳號");
  const role = resolved.membership.role;
  if (!resolved.membership.isActive || (role !== "OWNER" && role !== "MANAGER")) return fail("沒有權限開通員工帳號");
  const admin = createServiceRoleClient();
  if (!admin) return fail("管理員服務尚未設定");
  const {data: target, error: targetError} = await admin.from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .select("id, organization_id, auth_user_id, role, is_active, email")
    .eq("id", input.membershipId).eq("organization_id", input.organizationId).maybeSingle();
  if (targetError) return fail("無法讀取正式員工資料，請稍後再試");
  if (!target) return fail("這位員工尚未同步至正式資料庫，請先儲存員工資料並重新整理，再開通登入帳號");
  if (!isStaffAuthRole(target.role) || !target.is_active) return fail("員工資料尚未啟用，無法開通登入帳號");
  if (target.role === "OWNER" || (target.role === "MANAGER" && role !== "OWNER")) return fail("沒有權限開通此員工");
  if (target.auth_user_id) return fail("員工已有登入帳號，請使用主管設定員工密碼功能");
  if (target.email && target.email.trim().toLowerCase() !== email) return fail("Email 與員工資料不一致，請先更新員工基本資料");
  const {data: bound, error: boundError} = await admin.from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .select("id").ilike("email", email).neq("id", input.membershipId).limit(1);
  if (boundError || (bound && bound.length)) return fail("此 Email 已被其他員工使用，請檢查資料");
  // Refuse to create another identity when the email belongs to a staff member in any organization.
  const lookup = await lookupAuthUserIdForStaffEmail(email);
  if (!lookup.ok) return fail(lookup.message);
  // Existing unverified, never-used accounts may be reconciled only when they
  // have no staff or customer ownership. Never take over a verified account.
  const existingUserId = lookup.authUserId;
  if (existingUserId) {
    const {data: existing, error: existingError} = await admin.auth.admin.getUserById(existingUserId);
    if (existingError || !existing.user || existing.user.email?.toLowerCase() !== email ||
      existing.user.email_confirmed_at || existing.user.last_sign_in_at) {
      return fail("此 Email 已有使用中的登入帳號，不能由主管接管");
    }
    const {data: links, error: linksError} = await admin.from(STAFF_AUTH_MEMBERSHIPS_TABLE)
      .select("id").eq("auth_user_id", existingUserId).limit(1);
    const {data: customerLinks, error: customerError} = await admin.from("member_customer_links")
      .select("auth_user_id").eq("auth_user_id", existingUserId).limit(1);
    if (linksError || customerError || links?.length || customerLinks?.length) {
      return fail("此 Email 已有其他身分綁定，不能由主管接管");
    }
  }
  let userId = existingUserId;
  if (!userId) {
    const {data: created, error: createError} = await admin.auth.admin.createUser({
      email, password: input.newPassword, email_confirm: true,
    });
    if (createError || !created.user) return fail("建立登入帳號失敗，請確認 Email 是否已使用");
    userId = created.user.id;
  }
  // Audit must exist before modifying an existing account's credentials.
  const {data: audit, error: auditError} = await admin.from("staff_password_reset_audit").insert({
    organization_id: input.organizationId, actor_auth_user_id: actor.id,
    target_auth_user_id: userId, target_membership_id: target.id,
    status: "attempted",
  }).select("id").single();
  if (auditError || !audit) return fail("帳號已存在，但無法建立稽核紀錄；請聯絡管理員，勿重複開通");
  if (existingUserId) {
    const {error: updateError} = await admin.auth.admin.updateUserById(existingUserId, {
      password: input.newPassword, email_confirm: true,
    });
    if (updateError) {
      await admin.from("staff_password_reset_audit").update({
        status: "failed", completed_at: new Date().toISOString(),
      }).eq("id", audit.id).eq("status", "attempted");
      return fail("舊帳號密碼設定失敗，未綁定員工資料");
    }
  }
  try {
    await admin.from(STAFF_AUTH_MEMBERSHIPS_TABLE)
      .update({auth_user_id: userId, email})
      .eq("id", target.id).eq("organization_id", input.organizationId)
      .is("auth_user_id", null).select("id").maybeSingle();
  } catch {
    // Read-back below determines the outcome, including lost responses.
  }
  // A failed response may hide a successful database commit. Read back the
  // membership before deciding whether to retry or report failure.
  let recovery: ReturnType<typeof classifyBindingRecovery> = "unknown";
  try {
    const checked = await admin.from(STAFF_AUTH_MEMBERSHIPS_TABLE)
      .select("auth_user_id").eq("id", target.id)
      .eq("organization_id", input.organizationId).maybeSingle();
    recovery = classifyBindingRecovery(Boolean(checked.error), Boolean(checked.data),
      checked.data?.auth_user_id ?? null, userId);
  } catch {
    recovery = "unknown";
  }
  const actuallyBound = recovery === "bound";
  const {error: finalizeError} = await admin.from("staff_password_reset_audit")
    .update({status: actuallyBound ? "succeeded" : "failed", completed_at: new Date().toISOString()})
    .eq("id", audit.id).eq("status", "attempted");
  if (finalizeError) return fail("帳號操作已執行，但稽核結果無法確認，請聯絡管理員，勿重複開通");
  if (!actuallyBound) return fail("帳號已建立，但無法確認員工綁定成功；請聯絡管理員，勿重複開通");
  return {ok: true, message: "員工登入帳號已開通，可使用 Email 和設定的密碼登入"};
}
