/**
 * Server-side page authorization. Navigation visibility is not enough.
 */

import type { StaffRole } from "@/types/saas";

export type StaffRolePageAccess = "login" | "forbidden" | "ok";

export const STAFF_SETTINGS_ROLES = ["OWNER", "MANAGER"] as const satisfies readonly StaffRole[];
export const STAFF_LINE_ROLES = ["OWNER"] as const satisfies readonly StaffRole[];
export const STAFF_FINANCE_ROLES = [
  "OWNER",
  "MANAGER",
  "ACCOUNTANT",
] as const satisfies readonly StaffRole[];
export const STAFF_TRANSACTION_ROLES = [
  "OWNER",
  "MANAGER",
  "RECEPTIONIST",
  "ACCOUNTANT",
] as const satisfies readonly StaffRole[];
export const STAFF_CATALOG_ROLES = [
  "OWNER",
  "MANAGER",
  "RECEPTIONIST",
] as const satisfies readonly StaffRole[];

export function resolveStaffRolePageAccess(input: {
  authenticated: boolean;
  role?: StaffRole | string | null;
  isActive?: boolean;
  allowedRoles: readonly StaffRole[];
}): StaffRolePageAccess {
  if (!input.authenticated) return "login";
  if (!input.isActive) return "forbidden";
  if (!input.role || !input.allowedRoles.includes(input.role as StaffRole)) {
    return "forbidden";
  }
  return "ok";
}

export function staffRolePageForbiddenHref(): "/staff/today" {
  return "/staff/today";
}

export function staffRolePageLoginHref(): "/staff/login" {
  return "/staff/login";
}
