import type { StaffRole } from "@/types/saas";
import { canAccessStaffWorkspace } from "@/lib/staff-auth/operational-capabilities";

export type StaffManagementAccess = "login" | "forbidden" | "ok";

export function isStaffManagementOwner(role: string | null | undefined): role is "OWNER" {
  return role === "OWNER";
}

export function isStaffManagementActor(
  role: string | null | undefined,
): role is "OWNER" | "MANAGER" {
  return role === "OWNER" || role === "MANAGER";
}

export function resolveStaffManagementAccess(input: {
  authenticated: boolean;
  role?: StaffRole | string | null;
  isActive?: boolean;
}): StaffManagementAccess {
  if (!input.authenticated) return "login";
  if (!input.isActive) return "forbidden";
  if (!canAccessStaffWorkspace({ role: input.role, isActive: input.isActive })) {
    return "forbidden";
  }
  return "ok";
}

export function staffManagementForbiddenHref(): "/staff/today" {
  return "/staff/today";
}

export function staffManagementLoginHref(): "/staff/login" {
  return "/staff/login";
}
