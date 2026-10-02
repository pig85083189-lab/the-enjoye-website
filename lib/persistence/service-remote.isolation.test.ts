import { describe, expect, it, vi } from "vitest";
import { UnmappedIdentityError } from "./identity-errors";
import { createMemoryRemotePersistence } from "./remote-factory";
import { ServiceRemoteAdapter } from "./service-remote-adapter";
import { remoteServicePayload, toRemoteServiceType } from "./service-mapping";
import { REMOTE_DEMO_SERVICE_MESSAGE } from "./demo-firewall";
import { ORG_A, ORG_B, STAFF_A, seedTwoOrgs } from "./test-identity-fixture";
import type { Service } from "@/types";
import type { ServiceTableStore } from "./operational-rows";

function realService(overrides: Partial<Service> = {}): Service {
  return {
    id: "svc-k7x1-ab12cd",
    organizationId: ORG_A,
    name: "深層暖宮護理",
    durationMinutes: 90,
    category: "暖宮",
    serviceType: "WOMB_CARE",
    priceMinor: 2800,
    isActive: true,
    ...overrides,
  };
}

describe("Phase 1C-1 service remote adapter", () => {
  it("maps generated svc-* to app_id + DB UUID", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const saved = await remote.services.upsert(ORG_A, realService(), STAFF_A);
    expect(saved.id).toBe("svc-k7x1-ab12cd");
    const orgDbId = remote.mapper.resolveOrganizationDbId(ORG_A);
    const row = db.getServiceByAppId(orgDbId, saved.id);
    expect(row?.app_id).toBe(saved.id);
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(row?.id).not.toBe(saved.id);
    expect(row?.organization_id).toBe(orgDbId);
    expect(row?.duration_minutes).toBe(90);
    expect(row?.price_minor).toBe(2800);
    expect(row?.service_type).toBe("WOMB_CARE");
    expect(row?.is_active).toBe(true);
    expect(remote.mapper.resolveServiceDbId(ORG_A, saved.id)).toBe(row?.id);
    expect(remoteServicePayload(row!)).not.toHaveProperty("price");
  });

  it("rejects seed / mock service ids and catalog names", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await expect(
      remote.services.upsert(ORG_A, realService({ id: "svc-breast", name: "自訂名稱" }), STAFF_A),
    ).rejects.toThrow(REMOTE_DEMO_SERVICE_MESSAGE);
    await expect(
      remote.services.upsert(ORG_A, realService({ name: "性感美胸 SPA" }), STAFF_A),
    ).rejects.toThrow(REMOTE_DEMO_SERVICE_MESSAGE);
    await expect(
      remote.services.upsert(ORG_A, realService({ id: "mock-svc-1" }), STAFF_A),
    ).rejects.toThrow(REMOTE_DEMO_SERVICE_MESSAGE);
  });

  it("isolates services by organization", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await remote.services.upsert(ORG_A, realService(), STAFF_A);
    const orgB = await remote.services.list(ORG_B);
    expect(orgB.some((row) => row.id === "svc-k7x1-ab12cd")).toBe(false);
    expect(orgB.some((row) => row.name === "深層暖宮護理")).toBe(false);
    await expect(
      remote.services.upsert(ORG_A, realService({ organizationId: ORG_B }), STAFF_A),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
  });

  it("maps documented serviceType aliases and fails unknown", () => {
    expect(toRemoteServiceType("ACID_DRAIN")).toBe("DETOX");
    expect(toRemoteServiceType("BELLY_CANDLE")).toBe("NAVEL_CANDLE");
    expect(toRemoteServiceType("GENERIC")).toBe("OTHER");
  });

  it("create does not insert when org is unmapped", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    const insert = vi.fn();
    const spy: ServiceTableStore = {
      insertService: (row) => {
        insert(row);
        db.insertService(row);
      },
      updateService: (row) => db.updateService(row),
      listServices: (org) => db.listServices(org),
      getServiceByAppId: (org, appId) => db.getServiceByAppId(org, appId),
      getServiceByDbId: (id) => db.getServiceByDbId(id),
    };
    const adapter = new ServiceRemoteAdapter(remote.mapper, spy);
    await expect(
      adapter.create("org-missing", {
        name: "真實課程",
        durationMinutes: 60,
        priceMinor: 1000,
        createdByStaffId: STAFF_A,
        serviceType: "FACIAL",
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    expect(insert).toHaveBeenCalledTimes(0);
  });
});
