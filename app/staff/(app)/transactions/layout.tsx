import type { ReactNode } from "react";
import { StaffRolePageLayout } from "@/lib/staff/StaffRolePageLayout";
import { STAFF_TRANSACTION_ROLES } from "@/lib/staff/staff-role-page-access";

export default async function TransactionsLayout({ children }: { children: ReactNode }) {
  return <StaffRolePageLayout allowedRoles={STAFF_TRANSACTION_ROLES}>{children}</StaffRolePageLayout>;
}
