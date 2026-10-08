import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";
import type { StaffInviteRecord, StaffInviteTarget } from "@/lib/staff-auth/staff-invite-command";
import { isInviteExpired, isStaffInviteStatus } from "@/lib/staff-auth/staff-invite-state";

type InviteRow = {
  id: string;
  membership_id: string;
  organization_id: string;
  email: string;
  invited_auth_user_id: string | null;
  status: string;
  expires_at: string;
  created_at?: string | null;
};

type MembershipRow = {
  id: string;
  organization_id: string;
  user_id: string;
  email: string | null;
  is_active: boolean;
  auth_user_id: string | null;
};

export function staffInviteFromRow(row: InviteRow): StaffInviteRecord | null {
  if (!row.id.startsWith("inv-") || !isStaffInviteStatus(row.status)) return null;
  return {
    id: row.id,
    membershipId: row.membership_id,
    organizationId: row.organization_id,
    email: row.email,
    invitedAuthUserId: row.invited_auth_user_id,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at ?? null,
  };
}

export function staffInviteTargetFromRow(row: MembershipRow): StaffInviteTarget {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    email: row.email,
    isActive: row.is_active,
    authUserId: row.auth_user_id,
  };
}

export async function loadStaffInviteForMembership(
  membershipId: string,
  organizationId: string,
): Promise<StaffInviteRecord | null> {
  if (!tryGetSupabaseEnv()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("staff_login_invites")
      .select("id, membership_id, organization_id, email, invited_auth_user_id, status, expires_at, created_at")
      .eq("membership_id", membershipId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error || !data) return null;
    const rows = data
      .map((row) => staffInviteFromRow(row as InviteRow))
      .filter((row): row is StaffInviteRecord => Boolean(row));
    return (
      rows.find((row) => row.status === "pending" && !isInviteExpired(row.expiresAt)) ??
      rows[0] ??
      null
    );
  } catch {
    return null;
  }
}

export async function loadPendingStaffInviteForAuthUser(
  authUserId: string,
): Promise<StaffInviteRecord | null> {
  if (!tryGetSupabaseEnv()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("staff_login_invites")
      .select("id, membership_id, organization_id, email, invited_auth_user_id, status, expires_at, created_at")
      .eq("invited_auth_user_id", authUserId)
      .eq("status", "pending")
      .limit(3);
    if (error || !data) return null;
    const now = Date.now();
    const rows = data
      .map((row) => staffInviteFromRow(row as InviteRow))
      .filter((row): row is StaffInviteRecord => Boolean(row));
    return rows.find((row) => Date.parse(row.expiresAt) > now) ?? rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function loadOrganizationStaffInvites(
  organizationId: string,
): Promise<StaffInviteRecord[]> {
  if (!tryGetSupabaseEnv()) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("staff_login_invites")
      .select("id, membership_id, organization_id, email, invited_auth_user_id, status, expires_at, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error || !data) return [];
    return data
      .map((row) => staffInviteFromRow(row as InviteRow))
      .filter((row): row is StaffInviteRecord => Boolean(row));
  } catch {
    return [];
  }
}

export async function loadStaffInviteTargetByMembershipId(
  membershipId: string,
  organizationId: string,
): Promise<StaffInviteTarget | null> {
  if (typeof window !== "undefined") {
    throw new Error("Staff invite target load cannot run in the browser");
  }
  const admin = createServiceRoleClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from("staff_auth_memberships")
    .select("id, organization_id, user_id, email, is_active, auth_user_id")
    .eq("id", membershipId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return staffInviteTargetFromRow(data as MembershipRow);
}

