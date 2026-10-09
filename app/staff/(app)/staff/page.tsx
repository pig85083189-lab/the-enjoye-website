import { redirect } from "next/navigation";
import { connection } from "next/server";
import { StaffRoleDeniedPanel } from "@/features/staff/StaffRoleDeniedPanel";
import { StaffWorkspacePage } from "@/features/staff/StaffWorkspacePage";
import {
  staffManagementLoginHref,
  resolveStaffManagementAccess,
} from "@/lib/staff/staff-management-access";
import { isStaffRemoteCreatePilotEnabled } from "@/lib/staff/staff-remote-create-flag";
import { isStaffRemoteWritePilotEnabled } from "@/lib/staff/staff-remote-write-flag";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import {
  isStaffInvitePilotEnabled,
  isStaffInviteSendOpen,
} from "@/lib/staff-auth/staff-invite-flag";

export default async function StaffPage() {
  await connection();
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
    return <StaffRoleDeniedPanel />;
  }

  return (
    <StaffWorkspacePage
      staffRemoteCreatePilot={isStaffRemoteCreatePilotEnabled()}
      staffRemoteWritePilot={isStaffRemoteWritePilotEnabled()}
      staffInvitePilot={isStaffInvitePilotEnabled()}
      staffInviteSendOpen={isStaffInviteSendOpen()}
    />
  );
}
