import type { ReactNode } from "react";
import { requireStaffRolePage } from "@/lib/staff/require-staff-role-page";
import { STAFF_TRANSACTION_ROLES } from "@/lib/staff/staff-role-page-access";

export default async function TransactionsLayout({ children }: { children: ReactNode }) {
  await requireStaffRolePage(STAFF_TRANSACTION_ROLES);
  return children;
}
