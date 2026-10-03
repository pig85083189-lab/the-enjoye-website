/**
 * Server-only Staff remote-create adapters.
 * Never import from Client Components.
 */
import {
  deleteStaffAuthMembership,
  fetchStaffAuthMembershipsByOrganizationId,
  upsertStaffAuthMembership,
} from "@/lib/staff-auth/membership-remote";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { StaffRemoteCreateError } from "./staff-remote-create-errors";
import type { StaffRemoteProvisionDeps } from "./staff-remote-provision";

export function createLiveStaffRemoteProvisionDeps(): StaffRemoteProvisionDeps {
  if (typeof window !== "undefined") {
    throw new Error("Staff remote create adapter cannot run in the browser");
  }
  const admin = createServiceRoleClient();
  if (!admin) {
    throw new StaffRemoteCreateError("pilot_disabled", "登入對應尚未設定，請聯絡系統管理員。");
  }

  return {
    async createAuthUser(email, password) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user?.id) {
        const message = error?.message ?? "";
        if (/already|registered|exists/i.test(message)) {
          throw new StaffRemoteCreateError("conflict", "無法使用這個 Email");
        }
        throw new StaffRemoteCreateError("auth_failed", "無法建立登入帳號");
      }
      return { id: data.user.id };
    },
    async deleteAuthUser(authUserId) {
      const { error } = await admin.auth.admin.deleteUser(authUserId);
      if (error) throw new Error(error.message);
    },
    async persistMembership(membership) {
      return upsertStaffAuthMembership(admin, membership);
    },
    async deleteMembership(membershipId) {
      await deleteStaffAuthMembership(admin, membershipId);
    },
    async listOrgMemberships(organizationId) {
      return fetchStaffAuthMembershipsByOrganizationId(admin, organizationId);
    },
    async listOrgLocationIds(organizationId) {
      const { data: organizations, error: orgError } = await admin
        .from("organizations")
        .select("id, app_id")
        .eq("app_id", organizationId);
      if (orgError) throw new Error(orgError.message);
      const organization = organizations?.[0];
      if (!organization?.id) return [];
      const { data: locations, error: locationError } = await admin
        .from("locations")
        .select("app_id, organization_id")
        .eq("organization_id", organization.id);
      if (locationError) throw new Error(locationError.message);
      return (locations ?? [])
        .map((row) => row.app_id)
        .filter((id): id is string => Boolean(id));
    },
  };
}
