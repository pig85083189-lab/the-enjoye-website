import type { ReactNode } from "react";
import { StaffShell } from "@/components/layout/StaffShell";
import { AccessUnavailablePanel } from "@/features/auth/AccessUnavailable";
import { StaffAuthProvider } from "@/lib/staff-auth/StaffAuthProvider";
import { resolveAuthenticatedStaffMembership } from "@/lib/staff-auth/resolve-membership";
import { getServerStaffAuthUser, loadServerMembershipsForAuthUser } from "@/lib/staff-auth/server";
import { ownerBootstrapAuthUserId } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function StaffAppLayout({ children }: { children: ReactNode }) {
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
    initialUser && resolved && resolved.status !== "ok",
  );

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
