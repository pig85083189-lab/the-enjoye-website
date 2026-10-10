import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { StaffShell } from "@/components/layout/StaffShell";
import { AccessUnavailablePanel } from "@/features/auth/AccessUnavailable";
import { StaffAuthProvider } from "@/lib/staff-auth/StaffAuthProvider";
import { resolveAuthenticatedStaffMembership } from "@/lib/staff-auth/resolve-membership";
import { getServerStaffAuthUser, loadServerMembershipsForAuthUser } from "@/lib/staff-auth/server";
import { loadStaffSessionGate } from "@/lib/staff-auth/staff-invite-session";
import {
  STAFF_ACCESS_UNAVAILABLE_HREF,
  STAFF_LOGIN_HREF,
  STAFF_SETUP_PASSWORD_HREF,
} from "@/lib/staff-auth/staff-invite-gate";
import { ownerBootstrapAuthUserId } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function StaffAppLayout({ children }: { children: ReactNode }) {
  const sessionGate = await loadStaffSessionGate();
  if (sessionGate.gate === "login") {
    redirect(STAFF_LOGIN_HREF);
  }
  if (sessionGate.gate === "setup_password") {
    redirect(STAFF_SETUP_PASSWORD_HREF);
  }

  const initialUser = await getServerStaffAuthUser();
  const initialMemberships = initialUser
    ? await loadServerMembershipsForAuthUser(initialUser.id)
    : [];
  const resolved = initialUser
    ? resolveAuthenticatedStaffMembership({
        authUserId: initialUser.id,
        memberships: initialMemberships,
        ownerBootstrapAuthUserId: ownerBootstrapAuthUserId(),
      })
    : null;
  const accessUnavailable = Boolean(
    initialUser &&
      resolved &&
      resolved.status !== "ok" &&
      sessionGate.gate === "access_unavailable",
  );
  if (sessionGate.gate === "access_unavailable" && !accessUnavailable) {
    redirect(STAFF_ACCESS_UNAVAILABLE_HREF);
  }

  return (
    <StaffAuthProvider initialUser={initialUser} initialMemberships={initialMemberships}>
      {accessUnavailable ? (
        <AccessUnavailablePanel />
      ) : (
        <StaffShell initialUser={initialUser}>{children}</StaffShell>
      )}
    </StaffAuthProvider>
  );
}
