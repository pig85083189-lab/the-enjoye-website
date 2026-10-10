import { createClient } from "@/lib/supabase/server";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import {
  resolveStaffSessionGate,
  type StaffSessionGate,
} from "@/lib/staff-auth/staff-invite-gate";

export async function hasPendingStaffInviteForAuthUser(
  authUserId: string,
): Promise<boolean> {
  if (!tryGetSupabaseEnv()) return false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("staff_login_invites")
      .select("id, expires_at, status")
      .eq("invited_auth_user_id", authUserId)
      .eq("status", "pending")
      .limit(3);
    if (error || !data) return false;
    const now = Date.now();
    return data.some((row) => Date.parse(String(row.expires_at)) > now);
  } catch {
    return false;
  }
}

export async function loadStaffSessionGate(): Promise<{
  gate: StaffSessionGate;
  authenticated: boolean;
}> {
  const user = await getServerStaffAuthUser();
  if (!user) {
    return { gate: "login", authenticated: false };
  }
  const resolved = await getAuthenticatedStaffMembership();
  const boundActiveMembership =
    resolved.status === "ok" && Boolean(resolved.membership?.isActive);
  const pendingInviteForAuthUser = boundActiveMembership
    ? false
    : await hasPendingStaffInviteForAuthUser(user.id);
  return {
    authenticated: true,
    gate: resolveStaffSessionGate({
      authenticated: true,
      boundActiveMembership,
      pendingInviteForAuthUser,
    }),
  };
}
