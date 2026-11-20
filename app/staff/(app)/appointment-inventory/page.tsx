import { connection } from "next/server";
import { AppointmentInventoryReport } from "@/features/appointments/AppointmentInventoryReport";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";

export const dynamic = "force-dynamic";

export default async function AppointmentInventoryPage() {
  await connection();
  const resolved = await getAuthenticatedStaffMembership();
  if (resolved.status !== "ok") {
    return (
      <article data-appointment-inventory="readonly">
        <h1 className="text-xl font-semibold text-text">本機預約盤點</h1>
        <p className="mt-2 text-sm text-secondary-text">需要已綁定的員工登入才能讀取正式資料。這頁不會寫入預約。</p>
      </article>
    );
  }

  return (
    <AppointmentInventoryReport
      organizationId={resolved.membership.organizationId}
      nowIso={new Date().toISOString()}
    />
  );
}
