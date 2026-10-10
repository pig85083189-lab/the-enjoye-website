import type { StaffRole } from "@/types/saas";

/** LINE connection and broadcast are Owner-only. Reuses staff_auth_memberships. */
export const LINE_MANAGE_ROLES = ["OWNER"] as const satisfies readonly StaffRole[];

export function canManageLineOfficialAccount(actor: {
  role?: StaffRole | string | null;
  isActive?: boolean;
} | null | undefined): boolean {
  return Boolean(
    actor?.isActive && actor.role && LINE_MANAGE_ROLES.includes(actor.role as StaffRole),
  );
}
