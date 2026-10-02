/**
 * Temporary Preview-only first-service bootstrap.
 * Explicit authenticated Owner path. Does not change getPersistenceDriver()
 * or enable remote persistence flags. Live Service / Appointment UI stays local.
 */

import {
  createServiceRecord,
  listPersistedServices,
} from "@/lib/services/service-queries";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import {
  AuthenticatedServiceTableStore,
  type AuthenticatedServiceSupabaseClient,
} from "@/lib/persistence/authenticated-service-store";
import { ServiceRemoteAdapter } from "@/lib/persistence/service-remote-adapter";
import type { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import { LOC_ENJOYE_PRIMARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import type { Service } from "@/types";
import type { TreatmentServiceType } from "@/types/treatment-template";

export const SERVICE_BOOTSTRAP_ROUTE = "/staff/service-bootstrap";

export const REMOTE_QA_SERVICE_NAME = "Remote QA Bust Care";
export const REMOTE_QA_SERVICE_TYPE: TreatmentServiceType = "BREAST";
export const REMOTE_QA_SERVICE_DURATION_MINUTES = 100;
export const REMOTE_QA_SERVICE_PRICE_MINOR = 3200;
export const REMOTE_QA_SERVICE_CATEGORY = "美胸";
export const REMOTE_QA_CREATED_BY_STAFF_ID = "staff-001";

export const BOOTSTRAP_TARGET = {
  organizationAppId: ORG_ENJOYE_ID,
  organizationDbId: "62bd49b6-a4c3-4da1-b53e-4746923685f1",
  locationAppId: LOC_ENJOYE_PRIMARY_ID,
  locationDbId: "c46b700c-bb42-45ce-be53-4484e217c3f8",
  operationalStaffId: REMOTE_QA_CREATED_BY_STAFF_ID,
  role: "OWNER",
} as const;

export const BOOTSTRAP_UNRELATED_ORG_UUID = "00000000-0000-4000-8000-000000000001";
export const BOOTSTRAP_UNRELATED_LOC_UUID = "00000000-0000-4000-8000-000000000002";

export const FIRST_REMOTE_SERVICE_PAYLOAD = {
  organizationId: BOOTSTRAP_TARGET.organizationAppId,
  name: REMOTE_QA_SERVICE_NAME,
  durationMinutes: REMOTE_QA_SERVICE_DURATION_MINUTES,
  priceMinor: REMOTE_QA_SERVICE_PRICE_MINOR,
  serviceType: REMOTE_QA_SERVICE_TYPE,
  category: REMOTE_QA_SERVICE_CATEGORY,
  isActive: true,
  createdByStaffId: REMOTE_QA_CREATED_BY_STAFF_ID,
} as const;

export type BootstrapRlsCheck = {
  organizationMembership: boolean | null;
  organizationRole: string | null;
  locationAccess: boolean | null;
  unrelatedOrganizationMembership: boolean | null;
  unrelatedLocationAccess: boolean | null;
};

export type BootstrapIdentityView = {
  authenticated: true;
  operationalStaffId: string;
  role: string;
  organizationAppId: string;
  locationAppId: string;
};

export type ServiceBootstrapClient = IdentitySupabaseClient &
  AuthenticatedServiceSupabaseClient & {
    rpc(
      fn: string,
      args: Record<string, string>,
    ): Promise<{ data: unknown; error: { message: string } | null }>;
  };

export type ServiceMappingView = {
  domainAppId: string;
  databaseUuid: string;
  reverseAppId: string;
};

export type ExistingOrCreatedService = {
  status: "existing" | "created";
  service: Service;
  mapping: ServiceMappingView;
};

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function asRole(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function rlsPrecheckPassed(check: BootstrapRlsCheck): boolean {
  return (
    check.organizationMembership === true &&
    check.organizationRole === BOOTSTRAP_TARGET.role &&
    check.locationAccess === true &&
    check.unrelatedOrganizationMembership === false &&
    check.unrelatedLocationAccess === false
  );
}

export function isRemoteQaService(service: Pick<Service, "name">): boolean {
  return service.name.trim() === REMOTE_QA_SERVICE_NAME;
}

export async function runAuthenticatedOwnerRlsPrecheck(
  client: ServiceBootstrapClient,
): Promise<BootstrapRlsCheck> {
  const { data: hasOrg } = await client.rpc("user_has_org_membership", {
    target_org: BOOTSTRAP_TARGET.organizationDbId,
  });
  const { data: orgRole } = await client.rpc("user_org_role", {
    target_org: BOOTSTRAP_TARGET.organizationDbId,
  });
  const { data: canLoc } = await client.rpc("user_can_access_location", {
    target_org: BOOTSTRAP_TARGET.organizationDbId,
    target_loc: BOOTSTRAP_TARGET.locationDbId,
  });
  const { data: hasWrongOrg } = await client.rpc("user_has_org_membership", {
    target_org: BOOTSTRAP_UNRELATED_ORG_UUID,
  });
  const { data: canWrongLoc } = await client.rpc("user_can_access_location", {
    target_org: BOOTSTRAP_TARGET.organizationDbId,
    target_loc: BOOTSTRAP_UNRELATED_LOC_UUID,
  });
  return {
    organizationMembership: asBoolean(hasOrg),
    organizationRole: asRole(orgRole),
    locationAccess: asBoolean(canLoc),
    unrelatedOrganizationMembership: asBoolean(hasWrongOrg),
    unrelatedLocationAccess: asBoolean(canWrongLoc),
  };
}

export function createExplicitAuthenticatedServiceAdapter(
  client: ServiceBootstrapClient,
  mapper: CanonicalIdMapper,
): ServiceRemoteAdapter {
  return new ServiceRemoteAdapter(mapper, new AuthenticatedServiceTableStore(client));
}

export async function loadServiceBootstrapContext(client: ServiceBootstrapClient): Promise<{
  identity: BootstrapIdentityView;
  rls: BootstrapRlsCheck;
  rlsPassed: boolean;
  adapter: ServiceRemoteAdapter;
  mapper: CanonicalIdMapper;
}> {
  const session = await client.auth.getUser();
  if (session.error || !session.data.user) {
    throw new Error("unauthenticated");
  }
  const loaded = await loadAuthenticatedIdentityCatalog(client);
  const location = loaded.catalog.findLocationByAppId(
    loaded.organizationDbId,
    BOOTSTRAP_TARGET.locationAppId,
  );
  if (
    loaded.organizationAppId !== BOOTSTRAP_TARGET.organizationAppId ||
    loaded.organizationDbId !== BOOTSTRAP_TARGET.organizationDbId ||
    loaded.operationalStaffId !== BOOTSTRAP_TARGET.operationalStaffId ||
    !location ||
    location.appId !== BOOTSTRAP_TARGET.locationAppId ||
    location.dbId !== BOOTSTRAP_TARGET.locationDbId
  ) {
    throw new Error("Authenticated identity does not match THE ENJOYE Owner target");
  }
  const rls = await runAuthenticatedOwnerRlsPrecheck(client);
  const adapter = createExplicitAuthenticatedServiceAdapter(client, loaded.mapper);
  return {
    identity: {
      authenticated: true,
      operationalStaffId: loaded.operationalStaffId,
      role: BOOTSTRAP_TARGET.role,
      organizationAppId: loaded.organizationAppId,
      locationAppId: location.appId,
    },
    rls,
    rlsPassed: rlsPrecheckPassed(rls),
    adapter,
    mapper: loaded.mapper,
  };
}

export async function findExistingRemoteQaService(
  adapter: ServiceRemoteAdapter,
): Promise<Service | undefined> {
  const rows = await listPersistedServices(
    BOOTSTRAP_TARGET.organizationAppId,
    undefined,
    { services: adapter },
  );
  return rows.find(isRemoteQaService);
}

function mappingFor(mapper: CanonicalIdMapper, service: Service): ServiceMappingView {
  const databaseUuid = mapper.resolveServiceDbId(service.organizationId, service.id);
  return {
    domainAppId: service.id,
    databaseUuid,
    reverseAppId: mapper.toServiceAppId(databaseUuid),
  };
}

export async function createFirstRemoteQaService(
  adapter: ServiceRemoteAdapter,
  mapper: CanonicalIdMapper,
): Promise<ExistingOrCreatedService> {
  const existing = await findExistingRemoteQaService(adapter);
  if (existing) {
    return {
      status: "existing",
      service: existing,
      mapping: mappingFor(mapper, existing),
    };
  }
  const service = await createServiceRecord(
    { ...FIRST_REMOTE_SERVICE_PAYLOAD },
    { services: adapter },
  );
  return {
    status: "created",
    service,
    mapping: mappingFor(mapper, service),
  };
}

export function isPreviewOnlyBootstrapAllowed(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  return vercelEnv !== "production";
}
