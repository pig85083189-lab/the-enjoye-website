import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { StaffRole } from "@/types/saas";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import {
  resolveStaffRolePageAccess,
  staffRolePageLoginHref,
  type StaffRolePageAccess,
} from "@/lib/staff/staff-role-page-access";
import type { AuthenticatedStaffMembershipResult } from "@/lib/staff-auth/resolve-membership";

export async function requireStaffRolePage(allowedRoles: readonly StaffRole[]): Promise<{
  access: StaffRolePageAccess;
  resolved: AuthenticatedStaffMembershipResult;
}> {
  await connection();
  const resolved = await getAuthenticatedStaffMembership();
  const access = resolveStaffRolePageAccess({
    authenticated: resolved.status !== "unauthenticated",
    role: resolved.membership?.role,
    isActive: resolved.membership?.isActive,
    allowedRoles,
  });
  if (access === "login") redirect(staffRolePageLoginHref());
  return { access, resolved };
}
