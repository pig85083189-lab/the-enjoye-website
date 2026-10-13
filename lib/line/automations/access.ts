import type { StaffRole } from "@/types/saas";

export const LINE_AUTOMATION_ROLES = ["OWNER"] as const satisfies readonly StaffRole[];

export function canShowLineAutomations(
  actor: { role?: StaffRole | string | null; isActive?: boolean } | null | undefined,
): boolean {
  return actor?.isActive === true && actor.role === "OWNER";
}
