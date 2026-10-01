import { redirect } from "next/navigation";
import { getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { resolveStaffEntryHref } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function StaffEntryPage() {
  const user = await getServerStaffAuthUser();
  redirect(resolveStaffEntryHref(Boolean(user)));
}
