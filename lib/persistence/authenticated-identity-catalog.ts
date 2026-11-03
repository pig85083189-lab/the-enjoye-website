/**
 * Authenticated IdentityCatalog read path.
 * Read-only. Never upserts organization / location / membership / profile.
 * A session with several organizations must name the selected organization.
 * The loader never picks the first membership.
 * Fails closed when the session, membership, organization, or location is missing.
 */

import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import { IdentityCatalogError } from "./identity-errors";
import { CanonicalIdMapper } from "./identity-map";
import { SnapshotIdentityCatalog } from "./snapshot-identity-catalog";
import type { IdentityCatalog, MappedOrgScoped, MappedStaff } from "./identity-catalog";

export type IdentityQueryResult<T = Record<string, unknown>> = {
  data: T[] | null;
  error: { message: string } | null;
};

export interface IdentityQueryBuilder<T = Record<string, unknown>>
  extends PromiseLike<IdentityQueryResult<T>> {
  eq(column: string, value: string): IdentityQueryBuilder<T>;
  in(column: string, values: string[]): IdentityQueryBuilder<T>;
  gte(column: string, value: string): IdentityQueryBuilder<T>;
  lte(column: string, value: string): IdentityQueryBuilder<T>;
  gt(column: string, value: string): IdentityQueryBuilder<T>;
  lt(column: string, value: string): IdentityQueryBuilder<T>;
}

export interface IdentitySupabaseClient {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
  from(table: string): {
    select(columns: string): IdentityQueryBuilder;
  };
}

type OrganizationRow = { id: string; app_id: string | null };
type LocationRow = { id: string; app_id: string | null; organization_id: string };
type CustomerRow = { id: string; app_id: string | null; organization_id: string };
type ServiceRow = { id: string; app_id: string | null; organization_id: string };
type MembershipRow = {
  id: string;
  user_id: string;
  auth_user_id: string | null;
  organization_id: string;
  role: string;
  is_active: boolean;
};

/** Selected tenant. locationAppId is required by calendar reads. */
export type AuthenticatedIdentityScope = {
  organizationAppId: string;
  locationAppId?: string;
};

export interface LoadedAuthenticatedIdentity {
  catalog: IdentityCatalog;
  mapper: CanonicalIdMapper;
  authUserId: string;
  organizationAppId: string;
  organizationDbId: string;
  operationalStaffId: string;
}

async function readRows<T>(builder: IdentityQueryBuilder): Promise<T[]> {
  const result = await builder;
  if (result.error) {
    throw new IdentityCatalogError("missing_mapping", result.error.message);
  }
  return (result.data ?? []) as T[];
}

function requireOne<T>(
  rows: T[],
  reason: IdentityCatalogError["reason"],
  message: string,
): T {
  if (rows.length === 0) {
    throw new IdentityCatalogError(reason === "ambiguous_mapping" ? "missing_mapping" : reason, message);
  }
  if (rows.length > 1) {
    throw new IdentityCatalogError("ambiguous_mapping", message);
  }
  return rows[0]!;
}

function toScoped(row: { id: string; app_id: string | null; organization_id: string }): MappedOrgScoped | null {
  if (!row.app_id) return null;
  return { dbId: row.id, appId: row.app_id, organizationDbId: row.organization_id };
}

type MembershipLocationRow = { membership_id: string; location_id: string };

/**
 * Empty staff_auth_membership_locations means every location in that organization.
 * A non-empty set is an allow-list of location app ids. This matches the
 * membership table comment and does not grant locations from another organization.
 */
async function assertLocationPermitted(
  client: IdentitySupabaseClient,
  membershipId: string,
  locationAppId: string,
  locations: MappedOrgScoped[],
): Promise<void> {
  const location = locations.find((row) => row.appId === locationAppId);
  if (!location) {
    throw new IdentityCatalogError("location_forbidden", "這個分店不屬於目前選擇的店家");
  }
  const grants = (
    await readRows<MembershipLocationRow>(
      client
        .from("staff_auth_membership_locations")
        .select("membership_id, location_id")
        .eq("membership_id", membershipId),
    )
  ).filter((row) => row.membership_id === membershipId && row.location_id);
  if (grants.length > 0 && !grants.some((row) => row.location_id === locationAppId)) {
    throw new IdentityCatalogError("location_forbidden", "沒有這個分店的權限");
  }
}

function selectMembership(
  memberships: MembershipRow[],
  organizationAppId: string,
): MembershipRow {
  if (!organizationAppId) {
    if (memberships.length === 1) return memberships[0]!;
    if (memberships.length === 0) {
      throw new IdentityCatalogError(
        "missing_membership",
        "No authenticated staff_auth_memberships row for this Auth user",
      );
    }
    throw new IdentityCatalogError(
      "ambiguous_membership",
      "Authenticated membership mapping is ambiguous",
    );
  }
  const matches = memberships.filter((row) => row.organization_id === organizationAppId);
  if (matches.length === 0) {
    throw new IdentityCatalogError("missing_membership", "此帳號沒有這個店家的員工身分");
  }
  if (matches.length > 1) {
    throw new IdentityCatalogError(
      "ambiguous_membership",
      "Authenticated membership mapping is ambiguous",
    );
  }
  return matches[0]!;
}

/**
 * Load identity mappings for the currently authenticated session.
 * Does not hardcode organization / location UUIDs.
 * Does not treat profiles.id as operational staff id.
 * Does not choose the first organization when the session has several.
 */
export async function loadAuthenticatedIdentityCatalog(
  client: IdentitySupabaseClient,
  scope?: AuthenticatedIdentityScope,
): Promise<LoadedAuthenticatedIdentity> {
  const session = await client.auth.getUser();
  if (session.error) {
    throw new IdentityCatalogError("unauthenticated", session.error.message);
  }
  const authUserId = session.data.user?.id;
  if (!authUserId) {
    throw new IdentityCatalogError("unauthenticated", "No authenticated session");
  }

  const memberships = (
    await readRows<MembershipRow>(
      client
        .from("staff_auth_memberships")
        .select("id, user_id, auth_user_id, organization_id, role, is_active")
        .eq("auth_user_id", authUserId),
    )
  ).filter((row) => row.is_active && row.auth_user_id === authUserId);

  const membership = selectMembership(memberships, scope?.organizationAppId?.trim() ?? "");
  if (isAuthUuid(membership.user_id) || membership.user_id === authUserId) {
    throw new IdentityCatalogError(
      "invalid_operational_staff",
      "Auth UUID must not be used as operational staff id",
    );
  }
  if (!membership.organization_id) {
    throw new IdentityCatalogError("missing_mapping", "Membership is missing organization app_id");
  }

  const organizations = await readRows<OrganizationRow>(
    client.from("organizations").select("id, app_id").eq("app_id", membership.organization_id),
  );
  const organization = requireOne(
    organizations.filter((row) => row.app_id === membership.organization_id),
    "missing_mapping",
    `Organization app_id ${JSON.stringify(membership.organization_id)} is unmapped or ambiguous`,
  );

  const locations = (
    await readRows<LocationRow>(
      client
        .from("locations")
        .select("id, app_id, organization_id")
        .eq("organization_id", organization.id),
    )
  )
    .map(toScoped)
    .filter((row): row is MappedOrgScoped => Boolean(row));

  const requestedLocation = scope?.locationAppId?.trim() ?? "";
  if (requestedLocation) {
    await assertLocationPermitted(client, membership.id, requestedLocation, locations);
  }

  const customers = (
    await readRows<CustomerRow>(
      client
        .from("customers")
        .select("id, app_id, organization_id")
        .eq("organization_id", organization.id),
    )
  )
    .map(toScoped)
    .filter((row): row is MappedOrgScoped => Boolean(row));

  const services = (
    await readRows<ServiceRow>(
      client
        .from("services")
        .select("id, app_id, organization_id")
        .eq("organization_id", organization.id),
    )
  )
    .map(toScoped)
    .filter((row): row is MappedOrgScoped => Boolean(row));

  const orgMemberships = (
    await readRows<MembershipRow>(
      client
        .from("staff_auth_memberships")
        .select("id, user_id, auth_user_id, organization_id, role, is_active")
        .eq("organization_id", membership.organization_id),
    )
  ).filter((row) => row.is_active && row.organization_id === membership.organization_id);

  const staff: MappedStaff[] = [];
  for (const row of orgMemberships) {
    if (!row.user_id || isAuthUuid(row.user_id) || row.user_id === row.auth_user_id) {
      continue;
    }
    staff.push({
      membershipDbId: row.id,
      // Auth user id is the Auth identity. Never an operational staff-* id.
      // Do not query profiles.id as operational identity.
      profileDbId: row.auth_user_id,
      authUserId: row.auth_user_id,
      staffAppId: row.user_id,
      organizationDbId: organization.id,
      role: row.role,
    });
  }
  if (!staff.some((row) => row.staffAppId === membership.user_id)) {
    staff.push({
      membershipDbId: membership.id,
      profileDbId: membership.auth_user_id,
      authUserId: membership.auth_user_id,
      staffAppId: membership.user_id,
      organizationDbId: organization.id,
      role: membership.role,
    });
  }

  const catalog = new SnapshotIdentityCatalog(
    [{ dbId: organization.id, appId: membership.organization_id }],
    locations,
    customers,
    services,
    staff,
  );
  const mapper = new CanonicalIdMapper(catalog);

  return {
    catalog,
    mapper,
    authUserId,
    organizationAppId: membership.organization_id,
    organizationDbId: organization.id,
    operationalStaffId: mapper.requireOperationalStaffId(
      membership.organization_id,
      membership.user_id,
    ),
  };
}
