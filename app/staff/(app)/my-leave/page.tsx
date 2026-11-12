import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { MyLeaveCalendar } from "@/features/staff/MyLeaveCalendar";

export default async function MyLeavePage() {
  await connection();
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status === "unauthenticated") redirect("/staff/login");
  if (auth.status !== "ok" || !auth.membership.locationIds.length) {
    return <main style={{ padding: 32 }}>目前無法使用休假申請，請聯絡店長確認員工帳號與所屬門市。</main>;
  }
  return <main><MyLeaveCalendar locationId={auth.membership.locationIds[0]} /></main>;
}
