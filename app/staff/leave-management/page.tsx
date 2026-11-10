import { redirect } from "next/navigation";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { LeaveManagementCalendar } from "@/features/staff/LeaveManagementCalendar";

export const dynamic = "force-dynamic";

export default async function LeaveManagementPage() {
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status !== "ok") redirect("/staff/login");
  const membership = auth.membership;
  if (!["OWNER", "MANAGER", "ADMIN"].includes(membership.role)) redirect("/staff");
  const locationId = membership.locationIds[0];
  if (!locationId) return <main style={{padding:32}}>尚未授權任何分店，無法查看休假管理。</main>;
  return <LeaveManagementCalendar locationId={locationId} />;
}
