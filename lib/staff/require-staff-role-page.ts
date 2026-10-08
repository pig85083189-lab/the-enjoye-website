import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { StaffRole } from "@/types/saas";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import {
  resolveStaffRolePageAccess,
  staffRolePageForbiddenHref,
  staffRolePageLoginHref,
} from "@/lib/staff/staff-role-page-access";

export async function requireStaffRolePage(allowedRoles: readonly StaffRole[]) {
  await connection();
  const resolved = await getAuthenticatedStaffMembership();
  const access = resolveStaffRolePageAccess({
    authenticated: resolved.status !== "unauthenticated",
    role: resolved.membership?.role,
    isActive: resolved.membership?.isActive,
    allowedRoles,
  });
  if (access === "login") redirect(staffRolePageLoginHref());
  if (access === "forbidden") redirect(staffRolePageForbiddenHref());
  return resolved;
}
