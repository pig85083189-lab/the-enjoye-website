import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_STAFF_OVERLAP_MESSAGE,
  BOOTSTRAP_TARGET,
  BOOTSTRAP_UNRELATED_LOC_UUID,
  BOOTSTRAP_UNRELATED_ORG_UUID,
  FIRST_REMOTE_APPOINTMENT_PAYLOAD,
  canShowCreateButton,
  createExplicitAuthenticatedAppointmentAdapter,
  createFirstRemoteQaAppointment,
  isExactQaAppointment,
  isPreviewOnlyBootstrapAllowed,
  mappingPrecheckPassed,
  qaAppointmentTaipeiDisplay,
  qaAppointmentTimeIsSafe,
  resolveQaAppointmentMapping,
  rlsPrecheckPassed,
  runAuthenticatedOwnerRlsPrecheck,
  type AppointmentBootstrapClient,
} from "./appointment-bootstrap";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentityQueryBuilder,
  type IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import { APPOINTMENT_INSERT_ONLY_MESSAGE } from "@/lib/persistence/authenticated-appointment-store";
import { createMemoryRemotePersistence } from "@/lib/persistence/remote-factory";
import { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import { SnapshotIdentityCatalog } from "@/lib/persistence/snapshot-identity-catalog";
import { isGeneratedAppointmentAppId } from "@/lib/persistence/demo-firewall";
import { createAppointmentRecord } from "@/lib/appointments/appointment-queries";
import { FUTURE_QA_APPOINTMENT } from "@/lib/appointments/remote-readiness";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-pilot";
import { APPOINTMENT_INTEGRITY_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const ORG_APP = BOOTSTRAP_TARGET.organizationAppId;
const ORG_UUID = BOOTSTRAP_TARGET.organizationDbId;
const LOC_APP = BOOTSTRAP_TARGET.locationAppId;
const LOC_UUID = BOOTSTRAP_TARGET.locationDbId;
const STAFF_APP = BOOTSTRAP_TARGET.operationalStaffId;
const ROOT = process.cwd();

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
}): AppointmentBootstrapClient {
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
      };
    },
    async rpc(fn: string, args: Record<string, string>) {
      return { data: input.rpc?.[`${fn}:${JSON.stringify(args)}`] ?? input.rpc?.[fn] ?? null, error: null };
    },
  } as unknown as AppointmentBootstrapClient;
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
    customers: [
      {
        id: BOOTSTRAP_TARGET.customerDbId,
        app_id: BOOTSTRAP_TARGET.customerAppId,
        organization_id: ORG_UUID,
      },
    ],
    services: [
      {
        id: BOOTSTRAP_TARGET.serviceDbId,
        app_id: BOOTSTRAP_TARGET.serviceAppId,
        organization_id: ORG_UUID,
      },
    ],
    appointments: [],
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

function seedEnjoyeRemote() {
  const { db, remote } = createMemoryRemotePersistence();
  const org = db.seedOrganization(ORG_APP, "THE ENJOYE");
  db.seedLocation(org.dbId, LOC_APP, "主店");
  db.seedCustomer(org.dbId, BOOTSTRAP_TARGET.customerAppId, BOOTSTRAP_TARGET.customerName);
  db.seedService(org.dbId, BOOTSTRAP_TARGET.serviceAppId, BOOTSTRAP_TARGET.serviceName);
  db.seedStaff(org.dbId, STAFF_APP, "OWNER");
  return { db, remote, org };
}

describe("Phase 1C-5B first remote appointment bootstrap", () => {
  it("is Preview-only and Production has no create capability", () => {
    expect(isPreviewOnlyBootstrapAllowed("production")).toBe(false);
    expect(isPreviewOnlyBootstrapAllowed("preview")).toBe(true);
    const page = readFileSync(path.join(ROOT, "app/staff/appointment-bootstrap/page.tsx"), "utf8");
    expect(page).toMatch(/isPreviewOnlyBootstrapAllowed/);
    expect(page).toMatch(/Production has no create capability/);
  });

  it("does not use service role on the Appointment write path", () => {
    const files = [
      "lib/staff-auth/appointment-bootstrap.ts",
      "app/staff/appointment-bootstrap/AppointmentBootstrapClient.tsx",
      "lib/persistence/authenticated-appointment-store.ts",
      "lib/persistence/appointment-remote-adapter.ts",
      "lib/appointments/appointment-queries.ts",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("keeps ScheduleAppointment canonical and Taipei conversion exact", () => {
    expect(qaAppointmentTimeIsSafe()).toBe(true);
    const display = qaAppointmentTaipeiDisplay();
    expect(display).toEqual({
      date: "2026/10/09",
      range: "10:00–11:40",
      timezone: "Asia/Taipei",
      startAt: "2026-10-09T02:00:00.000Z",
      endAt: "2026-10-09T03:40:00.000Z",
    });
    expect(FIRST_REMOTE_APPOINTMENT_PAYLOAD.startAt).toBe("2026-10-09T02:00:00.000Z");
    expect(FIRST_REMOTE_APPOINTMENT_PAYLOAD.endAt).toBe("2026-10-09T03:40:00.000Z");
    expect(FIRST_REMOTE_APPOINTMENT_PAYLOAD.status).toBe("BOOKED");
    expect(FIRST_REMOTE_APPOINTMENT_PAYLOAD).not.toHaveProperty("id");
  });

  it("maps QA customer / service / location app ids to the verified UUIDs", () => {
    const catalog = new SnapshotIdentityCatalog(
      [{ appId: FUTURE_QA_APPOINTMENT.organizationAppId, dbId: FUTURE_QA_APPOINTMENT.organizationDbId }],
      [
        {
          organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
          appId: FUTURE_QA_APPOINTMENT.locationAppId,
          dbId: FUTURE_QA_APPOINTMENT.locationDbId,
        },
      ],
      [
        {
          organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
          appId: FUTURE_QA_APPOINTMENT.customerAppId,
          dbId: FUTURE_QA_APPOINTMENT.customerDbId,
        },
      ],
      [
        {
          organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
          appId: FUTURE_QA_APPOINTMENT.serviceAppId,
          dbId: FUTURE_QA_APPOINTMENT.serviceDbId,
        },
      ],
      [
        {
          membershipDbId: "mem-enjoye-owner",
          profileDbId: AUTH_UUID,
          authUserId: AUTH_UUID,
          staffAppId: STAFF_APP,
          organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
          role: "OWNER",
        },
      ],
    );
    const mapper = new CanonicalIdMapper(catalog);
    const mapping = resolveQaAppointmentMapping(mapper);
    expect(mappingPrecheckPassed(mapping)).toBe(true);
    expect(mapping.customerDbId).toBe("f4be267b-8159-4b7b-920c-44ac996b3d8e");
    expect(mapping.serviceDbId).toBe("bd4c1822-5375-48b6-a4f4-dd231da10ef2");
    expect(mapping.locationDbId).toBe("c46b700c-bb42-45ce-be53-4484e217c3f8");
    expect(mapping.staffAppId).toBe("staff-001");
  });

  it("rejects Auth UUID as operational staff_id", async () => {
    const { db, remote } = seedEnjoyeRemote();
    await expect(
      remote.appointments.create(ORG_APP, {
        ...FIRST_REMOTE_APPOINTMENT_PAYLOAD,
        staffId: AUTH_UUID,
        createdBy: AUTH_UUID,
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    expect(db.appointments).toHaveLength(0);
  });

  it("conflict protection blocks overlapping staff time and does not upsert", async () => {
    const { db, remote, org } = seedEnjoyeRemote();
    const other = db.seedCustomer(org.dbId, "cust-overlap-other", "Overlap Other");
    expect(other.appId).toBe("cust-overlap-other");
    await createAppointmentRecord(
      ORG_APP,
      {
        locationId: FIRST_REMOTE_APPOINTMENT_PAYLOAD.locationId,
        customerId: "cust-overlap-other",
        serviceId: FIRST_REMOTE_APPOINTMENT_PAYLOAD.serviceId,
        staffId: FIRST_REMOTE_APPOINTMENT_PAYLOAD.staffId,
        startAt: FIRST_REMOTE_APPOINTMENT_PAYLOAD.startAt,
        endAt: FIRST_REMOTE_APPOINTMENT_PAYLOAD.endAt,
        createdBy: FIRST_REMOTE_APPOINTMENT_PAYLOAD.createdBy,
      },
      remote,
    );
    await expect(createFirstRemoteQaAppointment(remote.appointments, remote.mapper)).rejects.toThrow(
      APPOINTMENT_STAFF_OVERLAP_MESSAGE,
    );
    expect(db.appointments).toHaveLength(1);
  });

  it("duplicate exact QA appointment is Existing / PASS and insert-only", async () => {
    const { db, remote } = seedEnjoyeRemote();
    const first = await createFirstRemoteQaAppointment(remote.appointments, remote.mapper);
    expect(first.status).toBe("created");
    expect(isGeneratedAppointmentAppId(first.appointment.id)).toBe(true);
    expect(isExactQaAppointment(first.appointment)).toBe(true);
    const second = await createFirstRemoteQaAppointment(remote.appointments, remote.mapper);
    expect(second.status).toBe("existing");
    expect(second.appointment.id).toBe(first.appointment.id);
    expect(db.appointments).toHaveLength(1);
    const source = readFileSync(path.join(ROOT, "lib/staff-auth/appointment-bootstrap.ts"), "utf8");
    expect(source).toMatch(/createAppointmentRecord/);
    expect(source).not.toMatch(/adapter\.upsert|upsert\(/);
    expect(APPOINTMENT_INSERT_ONLY_MESSAGE).toMatch(/insert-only/);
  });

  it("keeps customer / service / location same-org DB protection", () => {
    const integrity = readFileSync(path.join(ROOT, APPOINTMENT_INTEGRITY_MIGRATION_FILE), "utf8");
    expect(integrity).toContain("appointments_customer_same_org_fkey");
    expect(integrity).toContain("appointments_service_same_org_fkey");
    expect(integrity).toContain("appointments_location_same_org_fkey");
    expect(integrity).toMatch(/alter column location_id set not null/);
  });

  it("does not write Treatment / Checkout / Transaction from bootstrap", () => {
    const files = [
      "lib/staff-auth/appointment-bootstrap.ts",
      "app/staff/appointment-bootstrap/AppointmentBootstrapClient.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/createTreatment|insertTreatment|from\(["']treatments["']\)/);
      expect(source).not.toMatch(/createCheckout|from\(["']checkout/);
      expect(source).not.toMatch(/createTransaction|from\(["']transactions["']\)/);
      expect(source).not.toMatch(/BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE/);
    }
  });

  it("keeps Calendar / Today local and global persistence flags OFF", () => {
    expect(getPersistenceDriver({})).toBe("local");
    expect(getPersistenceDriver({ BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT: "1" })).toBe("local");
    expect(
      isCustomerRemoteReadPilotEnabled({
        BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT: "1",
      }),
    ).toBe(true);
    for (const file of ["features/calendar/CalendarPage.tsx", "features/today/TodayDashboard.tsx"]) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/createFirstRemoteQaAppointment|AppointmentRemoteAdapter|createAppointmentRecord/);
    }
    expect(canShowCreateButton({
      rlsPassed: true,
      mappingPassed: true,
      timeSafe: true,
      existing: false,
      conflict: false,
    })).toBe(true);
    expect(canShowCreateButton({
      rlsPassed: true,
      mappingPassed: true,
      timeSafe: true,
      existing: true,
      conflict: false,
    })).toBe(false);
  });

  it("RLS helper requires Owner membership and location access", async () => {
    const client = fakeClient({
      userId: AUTH_UUID,
      tables: validTables(),
      rpc: passingRpc(),
    });
    const check = await runAuthenticatedOwnerRlsPrecheck(client);
    expect(rlsPrecheckPassed(check)).toBe(true);
    expect(rlsPrecheckPassed({ ...check, locationAccess: false })).toBe(false);
    expect(rlsPrecheckPassed({ ...check, unrelatedLocationAccess: true })).toBe(false);
  });

  it("authenticated adapter can create one QA appointment through the session store", async () => {
    const tables = validTables();
    const client = fakeClient({
      userId: AUTH_UUID,
      tables,
      rpc: passingRpc(),
    });
    const loaded = await loadAuthenticatedIdentityCatalog(client);
    const adapter = createExplicitAuthenticatedAppointmentAdapter(client, loaded.mapper);
    const created = await createFirstRemoteQaAppointment(adapter, loaded.mapper);
    expect(created.status).toBe("created");
    expect(isGeneratedAppointmentAppId(created.appointment.id)).toBe(true);
    expect(created.appointment.staffId).toBe("staff-001");
    expect(created.appointment.staffId).not.toBe(AUTH_UUID);
    const again = await createFirstRemoteQaAppointment(adapter, loaded.mapper);
    expect(again.status).toBe("existing");
    expect((tables.appointments ?? []).length).toBe(1);
  });

  it("does not query raw appointments from the bootstrap React module", () => {
    const client = readFileSync(
      path.join(ROOT, "app/staff/appointment-bootstrap/AppointmentBootstrapClient.tsx"),
      "utf8",
    );
    expect(client).toMatch(/createFirstRemoteQaAppointment/);
    expect(client).toMatch(/Create First Remote Appointment/);
    expect(client).not.toMatch(/\.from\(\s*["']appointments["']\s*\)/);
    expect(existsSync(path.join(ROOT, "app/staff/appointment-bootstrap/page.tsx"))).toBe(true);
  });
});
