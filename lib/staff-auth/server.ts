import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { MEMBERSHIP_ENJOYE_OWNER_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { tryGetSupabaseEnv, ownerBootstrapAuthUserId } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { StaffAuthUser } from "@/lib/staff-auth/session";
import type { StaffMembership } from "@/types/saas";
import {
  bindStaffAuthMembershipAuthUser,
  fetchStaffAuthMembershipsByAuthUserId,
  fetchStaffAuthMembershipsByOrganizationId,
  upsertStaffAuthMembership,
} from "@/lib/staff-auth/membership-remote";
import {
  operationalUserIdFromResolution,
  resolveAuthenticatedStaffMembership,
  type AuthenticatedStaffMembershipResult,
} from "@/lib/staff-auth/resolve-membership";

/** Server authorization: auth.getUser(), never getSession() alone. */
export async function getServerStaffAuthUser(): Promise<StaffAuthUser | null> {
  if (!tryGetSupabaseEnv()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return {
      id: data.user.id,
      email: data.user.email ?? null,
    };
  } catch {
    return null;
  }
}

export async function getAuthenticatedStaffMembership(input?: {
  organizationId?: string | null;
}): Promise<AuthenticatedStaffMembershipResult> {
  const user = await getServerStaffAuthUser();
  if (!user) {
    return { status: "unauthenticated", membership: null, memberships: [] };
  }
  const memberships = await loadServerMembershipsForAuthUser(user.id);
  return resolveAuthenticatedStaffMembership({
    authUserId: user.id,
    organizationId: input?.organizationId,
    memberships,
    ownerBootstrapAuthUserId: ownerBootstrapAuthUserId(),
  });
}

export async function loadServerMembershipsForAuthUser(
  authUserId: string,
): Promise<StaffMembership[]> {
  const bootstrap = ownerBootstrapAuthUserId();
  const admin = createServiceRoleClient();
  if (admin) {
    await ensureOwnerBootstrapRow(authUserId);
    const mine = await fetchStaffAuthMembershipsByAuthUserId(admin, authUserId);
    const orgIds = new Set(mine.map((item) => item.organizationId));
    if (bootstrap === authUserId) orgIds.add(ORG_ENJOYE_ID);
    const roster: StaffMembership[] = [];
    const seen = new Set<string>();
    for (const organizationId of orgIds) {
      const rows = await fetchStaffAuthMembershipsByOrganizationId(
        admin,
        organizationId,
      );
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        roster.push(row);
      }
    }
    if (roster.length > 0) return roster;
  } else if (tryGetSupabaseEnv()) {
    try {
      const supabase = await createClient();
      const mine = await fetchStaffAuthMembershipsByAuthUserId(supabase, authUserId);
      if (mine.length > 0) return mine;
    } catch {
      // Fall through to bootstrap-only resolution.
    }
  }

  if (bootstrap === authUserId) {
    const seeded = SEED_MEMBERSHIPS.find((item) => item.id === MEMBERSHIP_ENJOYE_OWNER_ID);
    if (seeded) return [{ ...seeded, authUserId: bootstrap }];
  }
  return [];
}

export async function persistServerStaffMembership(
  membership: StaffMembership,
): Promise<StaffMembership> {
  const admin = createServiceRoleClient();
  if (!admin) {
    throw new Error("登入對應尚未設定，請聯絡系統管理員。");
  }
  return upsertStaffAuthMembership(admin, membership);
}

export async function bindServerStaffMembershipAuthUser(
  membershipId: string,
  authUserId: string,
): Promise<StaffMembership> {
  const admin = createServiceRoleClient();
  if (!admin) {
    throw new Error("登入對應尚未設定，請聯絡系統管理員。");
  }
  return bindStaffAuthMembershipAuthUser(admin, membershipId, authUserId);
}

export function operationalUserIdFromServerResolution(
  result: AuthenticatedStaffMembershipResult,
): string {
  return operationalUserIdFromResolution(result);
}

async function ensureOwnerBootstrapRow(authUserId: string): Promise<void> {
  const bootstrap = ownerBootstrapAuthUserId();
  if (!bootstrap || bootstrap !== authUserId) return;
  const admin = createServiceRoleClient();
  if (!admin) return;
  const seeded = SEED_MEMBERSHIPS.find((item) => item.id === MEMBERSHIP_ENJOYE_OWNER_ID);
  if (!seeded) return;
  await upsertStaffAuthMembership(admin, {
    ...seeded,
    authUserId: bootstrap,
  });
}
