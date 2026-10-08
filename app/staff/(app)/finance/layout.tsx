import type { ReactNode } from "react";
import { requireStaffRolePage } from "@/lib/staff/require-staff-role-page";
import { STAFF_FINANCE_ROLES } from "@/lib/staff/staff-role-page-access";

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  await requireStaffRolePage(STAFF_FINANCE_ROLES);
  return children;
}
