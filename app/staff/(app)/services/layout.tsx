import type { ReactNode } from "react";
import { StaffRolePageLayout } from "@/lib/staff/StaffRolePageLayout";
import { STAFF_CATALOG_ROLES } from "@/lib/staff/staff-role-page-access";

export default async function ServicesLayout({ children }: { children: ReactNode }) {
  return <StaffRolePageLayout allowedRoles={STAFF_CATALOG_ROLES}>{children}</StaffRolePageLayout>;
}
