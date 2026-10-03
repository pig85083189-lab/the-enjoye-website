import { redirect } from "next/navigation";
import { StaffWorkspacePage } from "@/features/staff/StaffWorkspacePage";
import {
  staffManagementForbiddenHref,
  staffManagementLoginHref,
  resolveStaffManagementAccess,
} from "@/lib/staff/staff-management-access";
import { isStaffRemoteCreatePilotEnabled } from "@/lib/staff/staff-remote-create-flag";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";

export default async function StaffPage() {
  const resolved = await getAuthenticatedStaffMembership();
  const access = resolveStaffManagementAccess({
    authenticated: resolved.status !== "unauthenticated",
    role: resolved.membership?.role,
    isActive: resolved.membership?.isActive,
  });
  if (access === "login") {
    redirect(staffManagementLoginHref());
  }
  if (access !== "ok") {
    redirect(staffManagementForbiddenHref());
  }

  return (
    <StaffWorkspacePage staffRemoteCreatePilot={isStaffRemoteCreatePilotEnabled()} />
  );
}
