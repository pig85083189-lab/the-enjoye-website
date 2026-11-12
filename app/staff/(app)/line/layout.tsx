import type { ReactNode } from "react";
import { StaffRolePageLayout } from "@/lib/staff/StaffRolePageLayout";
import { STAFF_LINE_ROLES } from "@/lib/staff/staff-role-page-access";

export default async function LineLayout({ children }: { children: ReactNode }) {
  return <StaffRolePageLayout allowedRoles={STAFF_LINE_ROLES}>{children}</StaffRolePageLayout>;
}
