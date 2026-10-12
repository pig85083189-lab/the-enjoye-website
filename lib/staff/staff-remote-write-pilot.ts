/**
 * Authenticated Staff operational CREATE runner.
 * Client / test import only. Server Components must use
 * staff-remote-write-flag.ts so the adapter graph stays out of RSC.
 *
 * Does not create Auth users, invites, passwords, or Magic Links.
 * Does not use service-role business write.
 */

import {
  loadAuthenticatedIdentityCatalog,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import {
  AuthenticatedStaffWriteStore,
  type AuthenticatedStaffWriteClient,
} from "@/lib/persistence/authenticated-staff-write-store";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { canCreateOperationalStaff } from "@/lib/staff-auth/operational-capabilities";
import { assertOperationalStaffId, isAuthUuid } from "@/lib/staff-auth/staff-id";
import type { StaffMembership } from "@/types/saas";
import {
  assertActorCanAssignLocations,
  prepareStaffOperationalCreateDraft,
  type StaffOperationalCreateDraft,
} from "./staff-remote-write-command";
import { isStaffRemoteWritePilotEnabled } from "./staff-remote-write-flag";
import {
  StaffWritePilotOffError,
  StaffWriteUnauthorizedError,
  refuseStaffWriteMutation,
} from "./staff-write-guard";

export {
  STAFF_REMOTE_WRITE_PILOT_ENV,
  isStaffRemoteWritePilotEnabled,
} from "./staff-remote-write-flag";

export type StaffWriteClient = AuthenticatedStaffWriteClient;

export interface AuthenticatedStaffWritePersistence {
  identity: LoadedAuthenticatedIdentity;
  staff: AuthenticatedStaffWriteStore;
  update(): never;
}

export async function createAuthenticatedStaffWritePersistence(
  client: StaffWriteClient,
  organizationAppId?: string | null,
): Promise<AuthenticatedStaffWritePersistence> {
  const identity = await loadAuthenticatedIdentityCatalog(client, organizationAppId);
  return {
    identity,
    staff: new AuthenticatedStaffWriteStore(client),
    update: () => refuseStaffWriteMutation("update"),
  };
}

async function loadOrgLocationAppIds(
  client: StaffWriteClient,
  organizationDbId: string,
): Promise<string[]> {
  const result = await client
    .from("locations")
    .select("app_id, organization_id")
    .eq("organization_id", organizationDbId);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? [])
    .map((row) => (typeof row.app_id === "string" ? row.app_id : ""))
    .filter(Boolean);
}

async function loadActorLocationAppIds(
  client: StaffWriteClient,
  membershipId: string,
): Promise<string[]> {
  const result = await client
    .from("staff_auth_membership_locations")
    .select("membership_id, location_id")
    .eq("membership_id", membershipId);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? [])
    .filter((row) => row.membership_id === membershipId)
    .map((row) => (typeof row.location_id === "string" ? row.location_id : ""))
    .filter(Boolean);
}

export async function runAuthenticatedStaffWriteCreate(
  client: StaffWriteClient,
  input: StaffOperationalCreateDraft,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<StaffMembership> {
  if (!isStaffRemoteWritePilotEnabled(env)) {
    throw new StaffWritePilotOffError();
  }
  const persistence = await createAuthenticatedStaffWritePersistence(
    client,
    input.organizationId,
  );
  const actor = persistence.identity.catalog.findStaffByAppId(
    persistence.identity.organizationDbId,
    persistence.identity.operationalStaffId,
  );
  if (
    !canCreateOperationalStaff({
      role: actor?.role,
      isActive: true,
    })
  ) {
    throw new StaffWriteUnauthorizedError();
  }
  const prepared = prepareStaffOperationalCreateDraft(input);
  if (input.organizationId && input.organizationId !== persistence.identity.organizationAppId) {
    throw new UnmappedIdentityError(
      "organization",
      persistence.identity.organizationAppId,
      input.organizationId,
    );
  }
  const orgLocationIds = await loadOrgLocationAppIds(
    client,
    persistence.identity.organizationDbId,
  );
  const actorLocationIds = await loadActorLocationAppIds(client, actor?.membershipDbId ?? "");
  assertActorCanAssignLocations(actorLocationIds, orgLocationIds, prepared.locationIds);
  assertOperationalStaffId(prepared.userId);
  if (isAuthUuid(prepared.userId) || prepared.userId === persistence.identity.authUserId) {
    throw new StaffWriteUnauthorizedError("Auth UUID 不得作為員工識別");
  }

  const created = await persistence.staff.insertOperationalStaff({
    membershipId: prepared.membershipId,
    userId: prepared.userId,
    organizationId: persistence.identity.organizationAppId,
    role: prepared.role,
    displayName: prepared.displayName,
    email: prepared.email,
    phone: prepared.phone,
    title: prepared.title,
    locationIds: prepared.locationIds,
    createdByStaffId: persistence.identity.operationalStaffId,
  });
  if (created.authUserId) {
    throw new StaffWriteUnauthorizedError("不得在此路徑建立登入帳號");
  }
  assertOperationalStaffId(created.userId);
  return created;
}

export async function listAuthenticatedOrgStaff(
  client: StaffWriteClient,
  organizationAppId?: string | null,
): Promise<StaffMembership[]> {
  const persistence = await createAuthenticatedStaffWritePersistence(client, organizationAppId);
  return persistence.staff.listOrgMemberships(persistence.identity.organizationAppId);
}
