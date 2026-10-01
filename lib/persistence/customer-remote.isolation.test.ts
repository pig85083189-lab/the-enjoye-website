import { describe, expect, it } from "vitest";
import { UnmappedIdentityError } from "./identity-errors";
import { createMemoryRemotePersistence } from "./remote-factory";
import {
  CRM_ONLY_CUSTOMER_FIELDS,
  LOCAL_ONLY_CUSTOMER_FIELDS,
  remoteCustomerPayload,
  toRemoteCustomerStatus,
} from "./customer-mapping";
import {
  ORG_A,
  ORG_B,
  STAFF_A,
  seedTwoOrgs,
} from "./test-identity-fixture";
import { REMOTE_DEMO_CUSTOMER_MESSAGE } from "./demo-firewall";
import type { Customer } from "@/types";

function customer(overrides: Partial<Customer> = {}): Customer {
  const now = "2026-10-01T00:00:00.000Z";
  return {
    id: "cust-1001",
    organizationId: ORG_A,
    name: "真實客人",
    phone: "0911-000-111",
    birthday: "1990/01/15",
    age: 36,
    membership: "vip",
    lastVisit: "2026/09/01",
    totalVisits: 3,
    packages: [
      {
        id: "pkg-local",
        customerId: "cust-1001",
        serviceId: "svc-x",
        serviceName: "x",
        remainingSessions: 4,
        totalSessions: 10,
      },
    ],
    lastServiceNotes: ["crm note"],
    trackingFocus: ["focus"],
    alerts: [],
    tags: [],
    email: "",
    lineId: "",
    occupation: "工程師",
    address: "台中",
    source: "instagram",
    gender: "female",
    primaryStaffId: STAFF_A,
    joinedAt: "2026/01/01",
    listStatus: "normal",
    preferences: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Phase 1B customer remote adapter", () => {
  it("maps cust-* to app_id + DB UUID", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const saved = await remote.customers.upsert(customer());
    expect(saved.id).toBe("cust-1001");
    const orgDbId = remote.mapper.resolveOrganizationDbId(ORG_A);
    const row = db.getCustomerByAppId(orgDbId, "cust-1001");
    expect(row?.app_id).toBe("cust-1001");
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(row?.id).not.toBe("cust-1001");
    expect(remote.mapper.resolveCustomerDbId(ORG_A, "cust-1001")).toBe(row?.id);
  });

  it("rejects demo-* and seed 王小美 remote upsert", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await expect(
      remote.customers.upsert(customer({ id: "demo-001", name: "王小美" })),
    ).rejects.toThrow(REMOTE_DEMO_CUSTOMER_MESSAGE);
    await expect(
      remote.customers.upsert(customer({ id: "demo-002", name: "林雅婷" })),
    ).rejects.toThrow(REMOTE_DEMO_CUSTOMER_MESSAGE);
    expect(
      db
        .listCustomers(remote.mapper.resolveOrganizationDbId(ORG_A))
        .some((row) => row.app_id.startsWith("demo-") || row.full_name === "王小美"),
    ).toBe(false);
  });

  it("transforms birthday slash date and maps vip", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await remote.customers.upsert(customer());
    const row = db.getCustomerByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), "cust-1001");
    expect(row?.birthday).toBe("1990-01-15");
    expect(row?.membership_tier).toBe("vip");
    expect(row?.is_vip).toBe(true);
    expect(row?.status).toBe("ACTIVE");
  });

  it("writes empty optional fields as null", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await remote.customers.upsert(customer({ email: "", lineId: "  ", gender: undefined }));
    const row = db.getCustomerByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), "cust-1001");
    expect(row?.email).toBeNull();
    expect(row?.line_user_id).toBeNull();
  });

  it("requires org mapping and fails closed on unknown org", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await expect(
      remote.customers.upsert(customer({ organizationId: "org-missing" })),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
  });

  it("fails closed when staff belongs to the wrong org", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    const { staffB } = seedTwoOrgs(db);
    await expect(
      remote.customers.upsert(customer({ primaryStaffId: staffB.staffAppId })),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
  });

  it("does not leak CRM-only or local-only fields into the remote payload", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await remote.customers.upsert(
      customer({ listStatus: "needs_follow_up" }),
    );
    const row = db.getCustomerByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), "cust-1001")!;
    const payload = remoteCustomerPayload(row);
    for (const field of CRM_ONLY_CUSTOMER_FIELDS) {
      expect(payload).not.toHaveProperty(field);
    }
    for (const field of LOCAL_ONLY_CUSTOMER_FIELDS) {
      expect(payload).not.toHaveProperty(field);
    }
    expect(payload).not.toHaveProperty("lastVisit");
    expect(payload).not.toHaveProperty("totalVisits");
    expect(payload).not.toHaveProperty("occupation");
    expect(payload).not.toHaveProperty("address");
    expect(payload).not.toHaveProperty("last_visit_date");
    expect(payload).not.toHaveProperty("visit_count");
    expect(payload.status).toBe("ACTIVE");
    expect(payload.status).not.toBe("needs_follow_up");
    expect(toRemoteCustomerStatus("needs_follow_up")).toBe("ACTIVE");
    expect(toRemoteCustomerStatus("inactive")).toBe("INACTIVE");
    expect(toRemoteCustomerStatus("archived")).toBe("ARCHIVED");
  });

  it("local adapter still uses the customers v1 key and stays async at the port", async () => {
    const { localOperationalPersistence } = await import("./local-adapter");
    const { getTenantStorageKey } = await import("@/lib/tenant/storage-keys");
    expect(getTenantStorageKey("org-the-enjoye", "customers")).toBe(
      "beauty-os:org-the-enjoye:customers:v1",
    );
    const listed = localOperationalPersistence.customers.list({
      organizationId: "org-the-enjoye",
    });
    expect(listed).toBeInstanceOf(Promise);
    const rows = await listed;
    expect(rows.some((item) => item.id === "demo-001")).toBe(true);
  });
});
