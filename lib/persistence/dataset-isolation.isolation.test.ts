import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryRemotePersistence } from "./remote-factory";
import { localOperationalPersistence } from "./local-adapter";
import { SEED_CUSTOMERS } from "@/data/seed-crm";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import {
  CUST_SHARED,
  LOC_A1,
  ORG_A,
  STAFF_A,
  SVC_SHARED,
  seedTwoOrgs,
} from "./test-identity-fixture";
import { REMOTE_DEMO_CUSTOMER_MESSAGE, REMOTE_DEMO_APPOINTMENT_MESSAGE } from "./demo-firewall";
import type { Customer } from "@/types";

describe("Phase 1B dataset isolation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("local seed never appears in supabase adapter results", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const remoteCustomers = await remote.customers.list({ organizationId: ORG_A });
    const seedIds = new Set(SEED_CUSTOMERS.map((c) => c.id));
    expect(remoteCustomers.some((row) => row.id === "demo-001")).toBe(false);
    expect(remoteCustomers.some((row) => row.name === "王小美")).toBe(false);
    expect(remoteCustomers.some((row) => seedIds.has(row.id))).toBe(false);
  });

  it("remote empty stays empty and does not fallback to demo", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    db.seedOrganization(ORG_A, "Org A");
    const customers = await remote.customers.list({ organizationId: ORG_A });
    const appointments = await remote.appointments.list({ organizationId: ORG_A });
    expect(customers).toEqual([]);
    expect(appointments).toEqual([]);
    expect(customers.some((row) => row.id === "demo-001")).toBe(false);
  });

  it("remote adapter cannot promote demo fixture customers or appointments", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const demo: Customer = {
      ...SEED_CUSTOMERS[0]!,
      organizationId: ORG_A,
    };
    await expect(remote.customers.upsert(demo)).rejects.toThrow(REMOTE_DEMO_CUSTOMER_MESSAGE);
    await expect(
      remote.appointments.create(ORG_A, {
        id: "apt-001",
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        startAt: "2026-10-01T02:00:00.000Z",
        endAt: "2026-10-01T03:00:00.000Z",
        createdBy: STAFF_A,
        customerName: "王小美",
      } as never),
    ).rejects.toThrow(REMOTE_DEMO_APPOINTMENT_MESSAGE);
  });

  it("local driver still surfaces seed customers", async () => {
    const local = await localOperationalPersistence.customers.list({
      organizationId: ORG_ENJOYE_ID,
    });
    expect(local.some((row) => row.id === "demo-001")).toBe(true);
  });
});
