/**
 * Reads the signed-in staff member's organizations and locations.
 * Uses the browser session client. Does not use the service role.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Location, Organization } from "@/types/saas";

type MembershipRow = {
  organization_id: string | null;
  is_active: boolean | null;
  auth_user_id: string | null;
};

type OrganizationRow = {
  id: string;
  app_id: string | null;
  name: string | null;
  timezone: string | null;
};

type LocationRow = {
  app_id: string | null;
  organization_id: string;
  name: string | null;
  timezone: string | null;
  is_primary: boolean | null;
  is_active: boolean | null;
};

export type RemoteTenantDirectory = {
  organizations: Organization[];
  locations: Location[];
};

export function directoryFromRemoteRows(input: {
  authUserId: string;
  memberships: MembershipRow[];
  organizations: OrganizationRow[];
  locations: LocationRow[];
  now?: string;
}): RemoteTenantDirectory {
  const allowedAppIds = new Set(
    input.memberships
      .filter(
        (row) =>
          row.is_active &&
          row.auth_user_id === input.authUserId &&
          row.organization_id,
      )
      .map((row) => row.organization_id as string),
  );
  const grouped = new Map<string, OrganizationRow[]>();
  for (const row of input.organizations) {
    if (!row.app_id || !allowedAppIds.has(row.app_id)) continue;
    const current = grouped.get(row.app_id) ?? [];
    current.push(row);
    grouped.set(row.app_id, current);
  }
  const uniqueOrganizations = [...grouped.values()]
    .filter((rows) => rows.length === 1)
    .map((rows) => rows[0]!);
  const now = input.now ?? new Date().toISOString();
  const organizations: Organization[] = uniqueOrganizations.map((row) => ({
    id: row.app_id!,
    name: row.name?.trim() || row.app_id!,
    slug: row.app_id!,
    timezone: row.timezone || "Asia/Taipei",
    currency: "TWD",
    locale: "zh-TW",
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  }));
  const appIdByDbId = new Map(uniqueOrganizations.map((row) => [row.id, row.app_id!]));
  const locations: Location[] = input.locations.flatMap((row) => {
    const organizationId = appIdByDbId.get(row.organization_id);
    if (!row.app_id || !organizationId) return [];
    return [
      {
        id: row.app_id,
        organizationId,
        name: row.name?.trim() || row.app_id,
        timezone: row.timezone || "Asia/Taipei",
        isPrimary: Boolean(row.is_primary),
        isActive: row.is_active !== false,
        createdAt: now,
        updatedAt: now,
      },
    ];
  });
  return { organizations, locations };
}

export async function loadRemoteTenantDirectory(
  client: SupabaseClient,
): Promise<RemoteTenantDirectory> {
  const session = await client.auth.getUser();
  const authUserId = session.data.user?.id;
  if (session.error || !authUserId) return { organizations: [], locations: [] };

  const membershipResult = await client
    .from("staff_auth_memberships")
    .select("organization_id, is_active, auth_user_id")
    .eq("auth_user_id", authUserId);
  if (membershipResult.error) {
    throw new Error(membershipResult.error.message);
  }
  const memberships = (membershipResult.data ?? []) as MembershipRow[];
  const organizationAppIds = [
    ...new Set(
      memberships
        .filter((row) => row.is_active && row.auth_user_id === authUserId && row.organization_id)
        .map((row) => row.organization_id as string),
    ),
  ];
  if (organizationAppIds.length === 0) return { organizations: [], locations: [] };

  const organizationResult = await client
    .from("organizations")
    .select("id, app_id, name, timezone")
    .in("app_id", organizationAppIds);
  if (organizationResult.error) throw new Error(organizationResult.error.message);
  const organizationRows = (organizationResult.data ?? []) as OrganizationRow[];
  const organizationIds = organizationRows
    .filter((row) => row.app_id && organizationAppIds.includes(row.app_id))
    .map((row) => row.id);
  const locationResult = organizationIds.length
    ? await client
        .from("locations")
        .select("app_id, organization_id, name, timezone, is_primary, is_active")
        .in("organization_id", organizationIds)
    : { data: [], error: null };
  if (locationResult.error) throw new Error(locationResult.error.message);

  return directoryFromRemoteRows({
    authUserId,
    memberships,
    organizations: organizationRows,
    locations: (locationResult.data ?? []) as LocationRow[],
  });
}
