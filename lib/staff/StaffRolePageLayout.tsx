import type { ReactNode } from "react";
import { StaffRoleDeniedPanel } from "@/features/staff/StaffRoleDeniedPanel";
import { requireStaffRolePage } from "@/lib/staff/require-staff-role-page";
import type { StaffRole } from "@/types/saas";

export async function StaffRolePageLayout({
  allowedRoles,
  children,
}: {
  allowedRoles: readonly StaffRole[];
  children: ReactNode;
}) {
  const { access } = await requireStaffRolePage(allowedRoles);
  if (access === "forbidden") return <StaffRoleDeniedPanel />;
  return children;
}
