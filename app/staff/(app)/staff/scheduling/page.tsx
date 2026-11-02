import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { staffManagementLoginHref } from "@/lib/staff/staff-management-access";
import { StaffLeaveApprovalPreview } from "@/features/staff/StaffLeaveApprovalPreview";

export default async function StaffSchedulingPage() {
  await connection();
  const resolved = await getAuthenticatedStaffMembership();
  if (resolved.status === "unauthenticated") redirect(staffManagementLoginHref());
  if (!resolved.membership?.isActive) {
    return <div className="rounded-2xl border border-border bg-surface p-6">無法存取排班管理：員工帳號未啟用。</div>;
  }
  return <StaffLeaveApprovalPreview role={resolved.membership.role} />;
}
