import type { ReactNode } from "react";
import { StaffRolePageLayout } from "@/lib/staff/StaffRolePageLayout";
import { STAFF_SETTINGS_ROLES } from "@/lib/staff/staff-role-page-access";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  return <StaffRolePageLayout allowedRoles={STAFF_SETTINGS_ROLES}>{children}</StaffRolePageLayout>;
}
