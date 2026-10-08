import type { ReactNode } from "react";
import { requireStaffRolePage } from "@/lib/staff/require-staff-role-page";
import { STAFF_SETTINGS_ROLES } from "@/lib/staff/staff-role-page-access";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requireStaffRolePage(STAFF_SETTINGS_ROLES);
  return children;
}
