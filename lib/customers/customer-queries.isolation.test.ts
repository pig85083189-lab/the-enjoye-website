import { beforeEach, describe, expect, it } from "vitest";
import {
  createCustomer,
  findCustomersByPhone,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "./customer-queries";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { localOperationalPersistence } from "@/lib/persistence/local-adapter";
import { createMemoryRemotePersistence } from "@/lib/persistence/remote-factory";
import {
  CRM_ONLY_CUSTOMER_FIELDS,
  LOCAL_ONLY_CUSTOMER_FIELDS,
  remoteCustomerPayload,
} from "@/lib/persistence/customer-mapping";
import { REMOTE_DEMO_CUSTOMER_MESSAGE } from "@/lib/persistence/demo-firewall";
import { ORG_A, STAFF_A, seedTwoOrgs } from "@/lib/persistence/test-identity-fixture";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { isGeneratedCustomerAppId } from "@/lib/persistence/demo-firewall";

describe("Phase 1C-1 customer async application layer", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("local async persistence matches the sync repository", async () => {
    const sync = localCustomerRepository.list({ organizationId: ORG_ENJOYE_ID });
    const asyncPort = await localOperationalPersistence.customers.list({
      organizationId: ORG_ENJOYE_ID,
    });
    const viaQueries = await listCustomers(ORG_ENJOYE_ID, localOperationalPersistence);
    expect(asyncPort.map((c) => c.id)).toEqual(sync.map((c) => c.id));
    expect(viaQueries.map((c) => c.id)).toEqual(sync.map((c) => c.id));
    expect(sync.some((c) => c.id === "demo-001")).toBe(true);
  });

  it("creates a real customer with generated cust-* and no demo residue", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await createCustomer(
      {
        organizationId: ORG_A,
        name: "林真實",
        phone: "0912-888-777",
        primaryStaffId: STAFF_A,
        birthday: "1992/03/08",
        membership: "regular",
        email: "",
      },
      remote,
    );
    expect(isGeneratedCustomerAppId(created.id)).toBe(true);
    expect(created.id.startsWith("cust-")).toBe(true);
    expect(created.lastVisit).toBe("");
    expect(created.totalVisits).toBe(0);
    expect(created.packages).toEqual([]);
    const row = db.getCustomerByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), created.id)!;
    expect(row.app_id).toBe(created.id);
    expect(row.id).not.toBe(created.id);
    expect(row.birthday).toBe("1992-03-08");
    expect(row.membership_tier).toBe("regular");
    expect(row.is_vip).toBe(false);
    expect(row.primary_staff_id).toBe(STAFF_A);
    expect(row.email).toBeNull();
    const payload = remoteCustomerPayload(row);
    for (const field of CRM_ONLY_CUSTOMER_FIELDS) {
      expect(payload).not.toHaveProperty(field);
    }
    for (const field of LOCAL_ONLY_CUSTOMER_FIELDS) {
      expect(payload).not.toHaveProperty(field);
    }
    expect(payload).not.toHaveProperty("last_visit_date");
    expect(payload).not.toHaveProperty("visit_count");
    expect(await getCustomer(ORG_A, created.id, remote)).toMatchObject({ id: created.id });
    expect(await findCustomersByPhone(ORG_A, "0912888777", remote)).toHaveLength(1);
  });

  it("reuses a caller-allocated generated customer app id", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await createCustomer(
      {
        id: "cust-allocated-id01",
        organizationId: ORG_A,
        name: "指定編號",
        phone: "0912000222",
        primaryStaffId: STAFF_A,
      },
      remote,
    );
    expect(created.id).toBe("cust-allocated-id01");
    expect(db.getCustomerByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), created.id)?.app_id).toBe(
      "cust-allocated-id01",
    );
  });

  it("rejects demo / seed customer promotion through the create flow", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await expect(
      createCustomer(
        {
          organizationId: ORG_A,
          name: "王小美",
          phone: "0912-345-678",
          primaryStaffId: STAFF_A,
        },
        remote,
      ),
    ).rejects.toThrow(REMOTE_DEMO_CUSTOMER_MESSAGE);
    expect(
      db
        .listCustomers(remote.mapper.resolveOrganizationDbId(ORG_A))
        .some((row) => row.full_name === "王小美"),
    ).toBe(false);
  });

  it("update payload stays on profile columns", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await createCustomer(
      {
        organizationId: ORG_A,
        name: "林真實",
        phone: "0912000111",
        primaryStaffId: STAFF_A,
        membership: "new",
      },
      remote,
    );
    const updated = await updateCustomer(
      ORG_A,
      created.id,
      { name: "林真實二", membership: "vip", email: "real@example.com" },
      remote,
    );
    expect(updated.name).toBe("林真實二");
    const row = db.getCustomerByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), created.id)!;
    expect(row.full_name).toBe("林真實二");
    expect(row.is_vip).toBe(true);
    expect(row.email).toBe("real@example.com");
    expect(remoteCustomerPayload(row)).not.toHaveProperty("packages");
  });

  it("remote empty stays empty and does not merge local seed", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    db.seedOrganization(ORG_A, "Org A");
    expect(await listCustomers(ORG_A, remote)).toEqual([]);
    const local = await listCustomers(ORG_ENJOYE_ID, localOperationalPersistence);
    expect(local.some((c) => c.id === "demo-001")).toBe(true);
  });
});
