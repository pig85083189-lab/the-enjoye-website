/**
 * Canonical operational vs administrative capabilities.
 * UI, catalog, and write runners should share these helpers.
 */
import type { StaffRole } from "@/types/saas";

export const STAFF_MANAGE_ROLES = new Set<StaffRole>(["OWNER"]);

export const APPOINTMENT_CREATE_ROLES = new Set<StaffRole>([
  "OWNER",
  "MANAGER",
  "STAFF",
  "RECEPTIONIST",
]);

export const CHECKOUT_ROLES = new Set<StaffRole>([
  "OWNER",
  "MANAGER",
  "STAFF",
  "RECEPTIONIST",
]);

export const APPOINTMENT_CANCEL_ROLES = new Set<StaffRole>([
  "OWNER",
  "MANAGER",
  "STAFF",
  "RECEPTIONIST",
]);

/**
 * Existing Treatment product access: OWNER / MANAGER / STAFF see the nav list;
 * RECEPTIONIST already enters Treatment from Today / Calendar.
 * ACCOUNTANT remains denied. Do not invent OWNER-only Treatment writes.
 */
export const TREATMENT_ACCESS_ROLES = new Set<StaffRole>([
  "OWNER",
  "MANAGER",
  "STAFF",
  "RECEPTIONIST",
]);

export const EXPENSE_CREATE_ROLES = new Set<StaffRole>(["OWNER", "MANAGER"]);

export type CapabilityActor = {
  role?: StaffRole | string | null;
  isActive?: boolean;
} | null | undefined;

function hasRole(actor: CapabilityActor, roles: ReadonlySet<StaffRole>): boolean {
  return Boolean(
    actor?.isActive && actor.role && roles.has(actor.role as StaffRole),
  );
}

export function canManageStaffCapability(actor: CapabilityActor): boolean {
  return hasRole(actor, STAFF_MANAGE_ROLES);
}

export function canCreateAppointment(actor: CapabilityActor): boolean {
  return hasRole(actor, APPOINTMENT_CREATE_ROLES);
}

export function canCheckout(actor: CapabilityActor): boolean {
  return hasRole(actor, CHECKOUT_ROLES);
}

/** Existing 開單 path is Checkout draft creation, not a second order domain. */
export function canOpenOrder(actor: CapabilityActor): boolean {
  return canCheckout(actor);
}

export function canCancelAppointment(actor: CapabilityActor): boolean {
  return hasRole(actor, APPOINTMENT_CANCEL_ROLES);
}

export function canReadTreatment(actor: CapabilityActor): boolean {
  return hasRole(actor, TREATMENT_ACCESS_ROLES);
}

export function canWriteTreatment(actor: CapabilityActor): boolean {
  return hasRole(actor, TREATMENT_ACCESS_ROLES);
}

export function canCreateExpense(actor: CapabilityActor): boolean {
  return hasRole(actor, EXPENSE_CREATE_ROLES);
}

export function resolveCheckoutAccess(input: {
  authenticated: boolean;
  role?: StaffRole | string | null;
  isActive?: boolean;
}): "login" | "forbidden" | "ok" {
  if (!input.authenticated) return "login";
  if (!canCheckout({ role: input.role, isActive: input.isActive })) return "forbidden";
  return "ok";
}
