import { redirect } from "next/navigation";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { LeaveReviewOverview } from "@/features/staff/LeaveReviewOverview";

export const dynamic = "force-dynamic";
export default async function LeaveReviewPage() {
 const auth = await getAuthenticatedStaffMembership();
 if (auth.status === "unauthenticated") redirect("/staff/login");
 if (auth.status !== "ok" || !["OWNER","MANAGER"].includes(auth.membership.role)) {
  return <main className="p-8">此頁僅限店長或管理者使用。</main>;
 }
 return <LeaveReviewOverview/>;
}
