import type { ReactNode } from "react";
import { requireStaffRolePage } from "@/lib/staff/require-staff-role-page";
import { STAFF_CATALOG_ROLES } from "@/lib/staff/staff-role-page-access";

export default async function ServicesLayout({ children }: { children: ReactNode }) {
  await requireStaffRolePage(STAFF_CATALOG_ROLES);
  return children;
}
