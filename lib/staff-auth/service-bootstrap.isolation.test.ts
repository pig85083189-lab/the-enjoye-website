import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_TARGET,
  BOOTSTRAP_UNRELATED_LOC_UUID,
  BOOTSTRAP_UNRELATED_ORG_UUID,
  FIRST_REMOTE_SERVICE_PAYLOAD,
  REMOTE_QA_SERVICE_NAME,
  createFirstRemoteQaService,
  createExplicitAuthenticatedServiceAdapter,
  isPreviewOnlyBootstrapAllowed,
  isRemoteQaService,
  rlsPrecheckPassed,
  runAuthenticatedOwnerRlsPrecheck,
  type ServiceBootstrapClient,
} from "./service-bootstrap";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentityQueryBuilder,
  type IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import { SERVICE_INSERT_ONLY_MESSAGE } from "@/lib/persistence/authenticated-service-store";
import { createMemoryRemotePersistence } from "@/lib/persistence/remote-factory";
import { toRemoteServiceType } from "@/lib/persistence/service-mapping";
import { seedTwoOrgs, ORG_A, ORG_B, STAFF_A } from "@/lib/persistence/test-identity-fixture";
import { isGeneratedServiceAppId } from "@/lib/persistence/demo-firewall";
import { createServiceRecord } from "@/lib/services/service-queries";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-pilot";
import type { DbService } from "@/lib/persistence/operational-rows";

const AUTH_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORG_APP = BOOTSTRAP_TARGET.organizationAppId;
const ORG_UUID = BOOTSTRAP_TARGET.organizationDbId;
const LOC_APP = BOOTSTRAP_TARGET.locationAppId;
const LOC_UUID = BOOTSTRAP_TARGET.locationDbId;
const STAFF_APP = BOOTSTRAP_TARGET.operationalStaffId;

type Row = Record<string, unknown>;

class FakeQuery implements IdentityQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{ column: string; value?: string; values?: string[] }> = [],
    private readonly write: ((row: Row) => void) | null = null,
    private readonly pendingInsert: Row | null = null,
  ) {}

  eq(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value }], this.write, this.pendingInsert);
  }

  in(column: string, values: string[]): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, values }], this.write, this.pendingInsert);
  }

  select(): IdentityQueryBuilder {
    return this;
  }

  then<TResult1 = IdentityQueryResult, TResult2 = never>(
    onfulfilled?: ((value: IdentityQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.pendingInsert && this.write) {
      this.write(this.pendingInsert);
      return Promise.resolve({ data: [this.pendingInsert], error: null }).then(
        onfulfilled,
        onrejected,
      );
    }
    const data = this.rows.filter((row) =>
      this.filters.every((filter) => {
        const current = row[filter.column];
        if (filter.values) return filter.values.includes(String(current));
        return current === filter.value;
      }),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function fakeClient(input: {
  userId: string | null;
  tables: Record<string, Row[]>;
  rpc?: Record<string, unknown>;
}): ServiceBootstrapClient {
  const tables = input.tables;
  return {
    auth: {
      async getUser() {
        return {
          data: { user: input.userId ? { id: input.userId } : null },
          error: null,
        };
      },
    },
    from(table: string) {
      const rows = tables[table] ?? [];
      return {
        select() {
          return new FakeQuery(rows);
        },
        insert(payload: Record<string, unknown>) {
          return new FakeQuery(rows, [], (next) => {
            rows.push(next);
          }, payload);
        },
        update() {
          return new FakeQuery(rows);
        },
      };
    },
    async rpc(fn: string, args: Record<string, string>) {
      const key = `${fn}:${JSON.stringify(args)}`;
      return { data: input.rpc?.[key] ?? input.rpc?.[fn] ?? null, error: null };
    },
  } as unknown as ServiceBootstrapClient;
}

function validTables(overrides?: Partial<Record<string, Row[]>>): Record<string, Row[]> {
  return {
    staff_auth_memberships: [
      {
        id: "mem-enjoye-owner",
        user_id: STAFF_APP,
        auth_user_id: AUTH_UUID,
        organization_id: ORG_APP,
        role: "OWNER",
        is_active: true,
      },
    ],
    organizations: [{ id: ORG_UUID, app_id: ORG_APP }],
    locations: [{ id: LOC_UUID, app_id: LOC_APP, organization_id: ORG_UUID }],
    customers: [],
    services: [],
    ...overrides,
  };
}

function passingRpc(): Record<string, unknown> {
  return {
    [`user_has_org_membership:${JSON.stringify({ target_org: ORG_UUID })}`]: true,
    [`user_org_role:${JSON.stringify({ target_org: ORG_UUID })}`]: "OWNER",
    [`user_can_access_location:${JSON.stringify({ target_org: ORG_UUID, target_loc: LOC_UUID })}`]: true,
    [`user_has_org_membership:${JSON.stringify({ target_org: BOOTSTRAP_UNRELATED_ORG_UUID })}`]: false,
    [`user_can_access_location:${JSON.stringify({ target_org: ORG_UUID, target_loc: BOOTSTRAP_UNRELATED_LOC_UUID })}`]: false,
  };
}

describe("Phase 1C-4 service remote foundation", () => {
  it("A/B. maps domain payload to remote columns and back", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await createServiceRecord(
      { ...FIRST_REMOTE_SERVICE_PAYLOAD, organizationId: ORG_A, createdByStaffId: STAFF_A },
      remote,
    );
    expect(created.name).toBe(REMOTE_QA_SERVICE_NAME);
    expect(created.serviceType).toBe("BREAST");
    expect(created.durationMinutes).toBe(100);
    expect(created.priceMinor).toBe(3200);
    const row = db.getServiceByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), created.id)!;
    expect(row.service_type).toBe("BREAST");
    expect(row.duration_minutes).toBe(100);
    expect(row.price_minor).toBe(3200);
    expect(row.name).toBe(REMOTE_QA_SERVICE_NAME);
    expect(row).not.toHaveProperty("location_id");
    expect(toRemoteServiceType("BREAST")).toBe("BREAST");
  });

  it("C/D/E. service app id is generated svc-* and not the database UUID", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await createServiceRecord(
      { ...FIRST_REMOTE_SERVICE_PAYLOAD, organizationId: ORG_A, createdByStaffId: STAFF_A },
      remote,
    );
    expect(isGeneratedServiceAppId(created.id)).toBe(true);
    const row = db.getServiceByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), created.id)!;
    expect(row.id).not.toBe(created.id);
    expect(row.app_id).toBe(created.id);
    expect(remote.mapper.resolveServiceDbId(ORG_A, created.id)).toBe(row.id);
    expect(remote.mapper.toServiceAppId(row.id)).toBe(created.id);
  });

  it("F. isolates services by organization", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await createServiceRecord(
      { ...FIRST_REMOTE_SERVICE_PAYLOAD, organizationId: ORG_A, createdByStaffId: STAFF_A },
      remote,
    );
    const other = await remote.services.list(ORG_B);
    expect(other.some((row) => row.id === created.id)).toBe(false);
    expect(other.some((row) => row.name === REMOTE_QA_SERVICE_NAME)).toBe(false);
  });

  it("G. Service schema is organization-scoped, not location-scoped", () => {
    expect(FIRST_REMOTE_SERVICE_PAYLOAD).not.toHaveProperty("locationId");
    const mapping = readFileSync(path.join(process.cwd(), "lib/persistence/service-mapping.ts"), "utf8");
    expect(mapping).not.toMatch(/location_id/);
    expect(mapping).toMatch(/organization_id/);
  });

  it("H. authenticated store and bootstrap do not use service role", () => {
    const files = [
      "lib/persistence/authenticated-service-store.ts",
      "lib/staff-auth/service-bootstrap.ts",
      "app/staff/service-bootstrap/ServiceBootstrapClient.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("I/J. duplicate protection is insert-only and does not upsert", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    const org = db.seedOrganization(BOOTSTRAP_TARGET.organizationAppId, "THE ENJOYE");
    db.seedStaff(org.dbId, BOOTSTRAP_TARGET.operationalStaffId, "OWNER");
    const first = await createFirstRemoteQaService(remote.services, remote.mapper);
    expect(first.status).toBe("created");
    const second = await createFirstRemoteQaService(remote.services, remote.mapper);
    expect(second.status).toBe("existing");
    expect(second.service.id).toBe(first.service.id);
    expect(
      db.listServices(org.dbId).filter((row) => row.name === REMOTE_QA_SERVICE_NAME),
    ).toHaveLength(1);

    const source = readFileSync(
      path.join(process.cwd(), "lib/staff-auth/service-bootstrap.ts"),
      "utf8",
    );
    expect(source).toMatch(/createServiceRecord/);
    expect(source).not.toMatch(/adapter\.upsert/);
    expect(SERVICE_INSERT_ONLY_MESSAGE).toMatch(/insert-only/);
  });

  it("K. bootstrap does not write appointments", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/staff-auth/service-bootstrap.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/createAppointment|insertAppointment|appointments/);
  });

  it("L. persistence global flags remain off and unnecessary", () => {
    expect(isPreviewOnlyBootstrapAllowed("production")).toBe(false);
    expect(isPreviewOnlyBootstrapAllowed("preview")).toBe(true);
    expect(getPersistenceDriver({})).toBe("local");
    expect(
      getPersistenceDriver({
        BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT: "1",
      }),
    ).toBe("local");
    expect(
      isCustomerRemoteReadPilotEnabled({
        BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT: "1",
      }),
    ).toBe(true);
  });

  it("M/N. Customer pilot and other live surfaces stay on their current SoT", () => {
    const listPage = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerListPage.tsx"),
      "utf8",
    );
    const detailPage = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerProfilePage.tsx"),
      "utf8",
    );
    expect(listPage).toMatch(/useCustomerRemoteList/);
    expect(detailPage).toMatch(/useCustomerRemoteDetail/);
    const catalogSurfaces = [
      "features/calendar/CalendarPage.tsx",
      "features/checkout/CheckoutPageClient.tsx",
      "features/services/ServiceCatalogPageClient.tsx",
    ];
    for (const file of catalogSurfaces) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).toMatch(/getServicesForOrganization/);
      expect(source).not.toMatch(/createFirstRemoteQaService|listPersistedServices|AuthenticatedServiceTableStore/);
    }
    for (const file of [
      "features/today/TodayDashboard.tsx",
      "features/treatments/TreatmentPageClient.tsx",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/createFirstRemoteQaService|AuthenticatedServiceTableStore/);
    }
  });

  it("O. bootstrap UI does not insert through supabase.from(services)", () => {
    const client = readFileSync(
      path.join(process.cwd(), "app/staff/service-bootstrap/ServiceBootstrapClient.tsx"),
      "utf8",
    );
    expect(client).toMatch(/createFirstRemoteQaService/);
    expect(client).not.toMatch(/\.from\(\s*["']services["']\s*\)/);
  });

  it("RLS helper requires Owner membership and denies unrelated org/location", async () => {
    const client = fakeClient({
      userId: AUTH_UUID,
      tables: validTables(),
      rpc: passingRpc(),
    });
    const check = await runAuthenticatedOwnerRlsPrecheck(client);
    expect(rlsPrecheckPassed(check)).toBe(true);
    expect(
      rlsPrecheckPassed({
        ...check,
        unrelatedOrganizationMembership: true,
      }),
    ).toBe(false);
    expect(
      rlsPrecheckPassed({
        ...check,
        unrelatedLocationAccess: true,
      }),
    ).toBe(false);
  });

  it("authenticated adapter can create through the session store", async () => {
    const tables = validTables();
    const client = fakeClient({
      userId: AUTH_UUID,
      tables,
      rpc: passingRpc(),
    });
    const loaded = await loadAuthenticatedIdentityCatalog(client);
    const adapter = createExplicitAuthenticatedServiceAdapter(client, loaded.mapper);
    const created = await createFirstRemoteQaService(adapter, loaded.mapper);
    expect(created.status).toBe("created");
    expect(isRemoteQaService(created.service)).toBe(true);
    expect(isGeneratedServiceAppId(created.service.id)).toBe(true);
    expect(created.mapping.domainAppId).toBe(created.service.id);
    expect(created.mapping.databaseUuid).not.toBe(created.service.id);
    expect(created.mapping.reverseAppId).toBe(created.service.id);
    const again = await createFirstRemoteQaService(adapter, loaded.mapper);
    expect(again.status).toBe("existing");
    const serviceRows = tables.services as unknown as DbService[];
    expect(serviceRows.filter((row) => row.name === REMOTE_QA_SERVICE_NAME)).toHaveLength(1);
  });
});
