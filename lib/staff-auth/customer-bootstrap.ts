/**
 * Temporary Preview-only first-customer bootstrap.
 * Explicit authenticated Owner path. Does not change getPersistenceDriver()
 * or enable remote persistence flags. Live Customer UI stays local.
 */

import { createCustomer, listCustomers } from "@/lib/customers/customer-queries";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import {
  AuthenticatedCustomerTableStore,
  type AuthenticatedCustomerSupabaseClient,
} from "@/lib/persistence/authenticated-customer-store";
import { CustomerRemoteAdapter } from "@/lib/persistence/customer-remote-adapter";
import type { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import { phonesMatch } from "@/lib/phone";
import {
  LOC_ENJOYE_PRIMARY_ID,
  ORG_ENJOYE_ID,
} from "@/lib/tenant/constants";
import type { Customer } from "@/types";

export const CUSTOMER_BOOTSTRAP_ROUTE = "/staff/customer-bootstrap";

export const REMOTE_QA_CUSTOMER_NAME = "Remote QA Customer";
export const REMOTE_QA_CUSTOMER_PHONE = "0911000001";
export const REMOTE_QA_PRIMARY_STAFF_ID = "staff-001";

export const BOOTSTRAP_TARGET = {
  organizationAppId: ORG_ENJOYE_ID,
  organizationDbId: "62bd49b6-a4c3-4da1-b53e-4746923685f1",
  locationAppId: LOC_ENJOYE_PRIMARY_ID,
  locationDbId: "c46b700c-bb42-45ce-be53-4484e217c3f8",
  operationalStaffId: REMOTE_QA_PRIMARY_STAFF_ID,
  role: "OWNER",
} as const;

export const BOOTSTRAP_UNRELATED_ORG_UUID = "00000000-0000-4000-8000-000000000001";
export const BOOTSTRAP_UNRELATED_LOC_UUID = "00000000-0000-4000-8000-000000000002";

export const FIRST_REMOTE_CUSTOMER_PAYLOAD = {
  organizationId: BOOTSTRAP_TARGET.organizationAppId,
  name: REMOTE_QA_CUSTOMER_NAME,
  phone: REMOTE_QA_CUSTOMER_PHONE,
  primaryStaffId: REMOTE_QA_PRIMARY_STAFF_ID,
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

export type CustomerBootstrapClient = IdentitySupabaseClient &
  AuthenticatedCustomerSupabaseClient & {
    rpc(
      fn: string,
      args: Record<string, string>,
    ): Promise<{ data: unknown; error: { message: string } | null }>;
  };

export type CustomerMappingView = {
  domainAppId: string;
  databaseUuid: string;
  reverseAppId: string;
};

export type ExistingOrCreatedCustomer = {
  status: "existing" | "created";
  customer: Customer;
  mapping: CustomerMappingView;
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

export function isRemoteQaCustomer(customer: Pick<Customer, "name" | "phone">): boolean {
  return (
    customer.name.trim() === REMOTE_QA_CUSTOMER_NAME &&
    phonesMatch(customer.phone, REMOTE_QA_CUSTOMER_PHONE)
  );
}

export async function runAuthenticatedOwnerRlsPrecheck(
  client: CustomerBootstrapClient,
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

export function createExplicitAuthenticatedCustomerAdapter(
  client: CustomerBootstrapClient,
  mapper: CanonicalIdMapper,
): CustomerRemoteAdapter {
  return new CustomerRemoteAdapter(mapper, new AuthenticatedCustomerTableStore(client));
}

export async function loadCustomerBootstrapContext(client: CustomerBootstrapClient): Promise<{
  identity: BootstrapIdentityView;
  rls: BootstrapRlsCheck;
  rlsPassed: boolean;
  adapter: CustomerRemoteAdapter;
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
  const adapter = createExplicitAuthenticatedCustomerAdapter(client, loaded.mapper);
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

export async function findExistingRemoteQaCustomer(
  adapter: CustomerRemoteAdapter,
): Promise<Customer | undefined> {
  const rows = await listCustomers(BOOTSTRAP_TARGET.organizationAppId, { customers: adapter });
  return rows.find(isRemoteQaCustomer);
}

function mappingFor(mapper: CanonicalIdMapper, customer: Customer): CustomerMappingView {
  const databaseUuid = mapper.resolveCustomerDbId(customer.organizationId, customer.id);
  return {
    domainAppId: customer.id,
    databaseUuid,
    reverseAppId: mapper.toCustomerAppId(databaseUuid),
  };
}

export async function createFirstRemoteQaCustomer(
  adapter: CustomerRemoteAdapter,
  mapper: CanonicalIdMapper,
): Promise<ExistingOrCreatedCustomer> {
  const existing = await findExistingRemoteQaCustomer(adapter);
  if (existing) {
    return {
      status: "existing",
      customer: existing,
      mapping: mappingFor(mapper, existing),
    };
  }
  const customer = await createCustomer({ ...FIRST_REMOTE_CUSTOMER_PAYLOAD }, { customers: adapter });
  return {
    status: "created",
    customer,
    mapping: mappingFor(mapper, customer),
  };
}

export function isPreviewOnlyBootstrapAllowed(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  return vercelEnv !== "production";
}
