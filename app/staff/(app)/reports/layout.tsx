import type { ReactNode } from "react";
import { StaffRolePageLayout } from "@/lib/staff/StaffRolePageLayout";
import { STAFF_FINANCE_ROLES } from "@/lib/staff/staff-role-page-access";

export default async function ReportsLayout({ children }: { children: ReactNode }) {
  return <StaffRolePageLayout allowedRoles={STAFF_FINANCE_ROLES}>{children}</StaffRolePageLayout>;
}
