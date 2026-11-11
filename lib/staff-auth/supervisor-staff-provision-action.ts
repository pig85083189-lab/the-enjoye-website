"use server";

import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { STAFF_AUTH_MEMBERSHIPS_TABLE, isStaffAuthRole } from "@/lib/staff-auth/membership-schema";
import { lookupAuthUserIdForStaffEmail } from "@/lib/staff-auth/staff-invite-send-adapter";
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
  if (targetError || !target || !isStaffAuthRole(target.role) || !target.is_active) return fail("員工資料不存在或尚未啟用");
  if (target.role === "OWNER" || (target.role === "MANAGER" && role !== "OWNER")) return fail("沒有權限開通此員工");
  if (target.auth_user_id) return fail("員工已有登入帳號，請使用主管設定員工密碼功能");
  if (target.email && target.email.trim().toLowerCase() !== email) return fail("Email 與員工資料不一致，請先更新員工基本資料");
  const {data: bound, error: boundError} = await admin.from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .select("id").eq("organization_id", input.organizationId).eq("email", email).neq("id", input.membershipId).limit(1);
  if (boundError || (bound && bound.length)) return fail("此 Email 已被其他員工使用，請檢查資料");
  const lookup = await lookupAuthUserIdForStaffEmail(email);
  if (!lookup.ok) return fail(lookup.message);
  if (lookup.authUserId) return fail("此 Email 已存在登入帳號，為保護帳號安全，不會自動接管");
  const {data: created, error: createError} = await admin.auth.admin.createUser({
    email, password: input.newPassword, email_confirm: true,
  });
  if (createError || !created.user) return fail("建立登入帳號失敗，請確認 Email 是否已使用");
  const userId = created.user.id;
  // Only attach to the still-unbound target. Do not overwrite another login binding.
  const {data: attached, error: attachError} = await admin.from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .update({auth_user_id: userId, email})
    .eq("id", target.id).eq("organization_id", input.organizationId)
    .is("auth_user_id", null).select("id").maybeSingle();
  if (attachError || !attached) return fail("帳號已建立但綁定失敗，請聯絡管理員處理，勿再次建立");
  const {error: auditError} = await admin.from("staff_password_reset_audit").insert({
    organization_id: input.organizationId, actor_auth_user_id: actor.id,
    target_auth_user_id: userId, target_membership_id: target.id,
    status: "succeeded", completed_at: new Date().toISOString(),
  });
  if (auditError) return fail("帳號已建立並綁定，但稽核紀錄未完成，請聯絡管理員確認");
  return {ok: true, message: "員工登入帳號已開通，可使用 Email 和設定的密碼登入"};
}
