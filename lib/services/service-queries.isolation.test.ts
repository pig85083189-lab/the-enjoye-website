import { describe, expect, it } from "vitest";
import { createServiceRecord, listPersistedServices } from "./service-queries";
import { createMemoryRemotePersistence } from "@/lib/persistence/remote-factory";
import { localOperationalPersistence } from "@/lib/persistence/local-adapter";
import { listServices } from "@/lib/services/store";
import { REMOTE_DEMO_SERVICE_MESSAGE } from "@/lib/persistence/demo-firewall";
import { ORG_A, STAFF_A, seedTwoOrgs } from "@/lib/persistence/test-identity-fixture";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { isGeneratedServiceAppId } from "@/lib/persistence/demo-firewall";

describe("Phase 1C-1 real service create flow", () => {
  it("creates a generated svc-* remote service without seed fallback", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await createServiceRecord(
      {
        organizationId: ORG_A,
        name: "經期舒緩護理",
        durationMinutes: 75,
        priceMinor: 2400,
        serviceType: "WOMB_CARE",
        createdByStaffId: STAFF_A,
      },
      remote,
    );
    expect(isGeneratedServiceAppId(created.id)).toBe(true);
    expect(created.name).toBe("經期舒緩護理");
    expect(created.durationMinutes).toBe(75);
    const listed = await listPersistedServices(ORG_A, undefined, remote);
    expect(listed.map((row) => row.id)).toContain(created.id);
    expect(listed.some((row) => row.id === "svc-breast")).toBe(false);
    expect(listed.some((row) => row.name === "性感美胸 SPA")).toBe(false);
    expect(db.getServiceByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), created.id)?.name).toBe(
      "經期舒緩護理",
    );
  });

  it("allows official Enjoye names on a generated svc-* id", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await createServiceRecord(
      {
        organizationId: ORG_A,
        name: "性感美胸 SPA",
        durationMinutes: 100,
        priceMinor: 3200,
        serviceType: "BREAST",
        createdByStaffId: STAFF_A,
      },
      remote,
    );
    expect(isGeneratedServiceAppId(created.id)).toBe(true);
    expect(created.id).not.toBe("svc-breast");
    expect(created.name).toBe("性感美胸 SPA");
    expect(created.priceMinor).toBe(3200);
  });

  it("refuses QA / Lumiere names even when the caller wants a new id", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await expect(
      createServiceRecord(
        {
          organizationId: ORG_A,
          name: "Remote QA Bust Care",
          durationMinutes: 100,
          priceMinor: 3200,
          serviceType: "BREAST",
          createdByStaffId: STAFF_A,
        },
        remote,
      ),
    ).rejects.toThrow(REMOTE_DEMO_SERVICE_MESSAGE);
    await expect(
      createServiceRecord(
        {
          organizationId: ORG_A,
          name: "光感臉部保養",
          durationMinutes: 90,
          priceMinor: 3000,
          serviceType: "FACIAL",
          createdByStaffId: STAFF_A,
        },
        remote,
      ),
    ).rejects.toThrow(REMOTE_DEMO_SERVICE_MESSAGE);
  });

  it("local async service list matches the sync store", async () => {
    const sync = listServices(ORG_ENJOYE_ID);
    const asyncList = await localOperationalPersistence.services.list(ORG_ENJOYE_ID);
    expect(asyncList.map((row) => row.id)).toEqual(sync.map((row) => row.id));
  });
});
