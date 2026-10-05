import { describe, expect, it } from "vitest";
import {
  DEMO_SEED_FLAG,
  isDemoSeedEnabled,
  promoteDemoRemainingSessionsToRemote,
  REMOTE_DEMO_PROMOTION_MESSAGE,
  REMOTE_DEMO_CUSTOMER_MESSAGE,
  REMOTE_DEMO_APPOINTMENT_MESSAGE,
  assertRemoteCustomerAllowed,
  assertRemoteAppointmentAllowed,
  assertRemoteTreatmentAllowed,
  REMOTE_DEMO_TREATMENT_MESSAGE,
} from "./demo-firewall";
import { createMemoryRemotePersistence, createRemoteOperationalPersistence, REMOTE_FLAGS } from "./remote-factory";
import { MemoryOperationalDb } from "./memory-operational-db";
import { getOperationalPersistence, getPersistenceDriver } from "./index";
import { SEED_BOUNDARY } from "./seed-policy";

describe("Phase 5A-2 demo seed firewall", () => {
  it("local demo flag does not enable remote persistence", () => {
    expect(isDemoSeedEnabled({ [DEMO_SEED_FLAG]: "1" })).toBe(true);
    expect(
      getPersistenceDriver({
        [DEMO_SEED_FLAG]: "1",
        BEAUTY_OS_PERSISTENCE: "supabase",
      }),
    ).toBe("local");
    expect(getOperationalPersistence({ [DEMO_SEED_FLAG]: "1" }).driver).toBe("local");
    expect(SEED_BOUNDARY.mustNotBecome).toContain("package_ledger_entries");
  });

  it("refuses to promote Customer.packages remainingSessions into a remote PURCHASE", () => {
    expect(() => promoteDemoRemainingSessionsToRemote()).toThrow(REMOTE_DEMO_PROMOTION_MESSAGE);
  });

  it("remote createPurchasedPackage rejects remainingSessions payload", async () => {
    const { remote } = createMemoryRemotePersistence();
    await expect(
      remote.packages.createPurchasedPackage("org-a", {
        customerId: "c",
        packageDefinitionId: "p",
        purchaseTransactionId: "t",
        locationId: "l",
        createdByStaffId: "s",
        effectKey: "k",
        remainingSessions: 5,
      } as never),
    ).rejects.toThrow(REMOTE_DEMO_PROMOTION_MESSAGE);
  });

  it("rejects demo-* / 王小美 customer promotion at the firewall", () => {
    expect(() => assertRemoteCustomerAllowed({ id: "demo-001", name: "王小美" })).toThrow(
      REMOTE_DEMO_CUSTOMER_MESSAGE,
    );
    expect(() =>
      assertRemoteAppointmentAllowed({ id: "apt-001", customerId: "demo-001" }),
    ).toThrow(REMOTE_DEMO_APPOINTMENT_MESSAGE);
    expect(() =>
      assertRemoteTreatmentAllowed({
        id: "treatment-seed-001",
        customerId: "cust-muqh2jn6-xpjssl",
      }),
    ).toThrow(REMOTE_DEMO_TREATMENT_MESSAGE);
    expect(() =>
      assertRemoteTreatmentAllowed({
        id: "treatment-apt-001c",
        customerId: "cust-muqh2jn6-xpjssl",
        appointmentId: "apt-001c",
      }),
    ).toThrow(REMOTE_DEMO_TREATMENT_MESSAGE);
  });
});

describe("Phase 5A-2 persistence selector", () => {
  it("createRemoteOperationalPersistence requires both flags", () => {
    const db = new MemoryOperationalDb();
    expect(() => createRemoteOperationalPersistence(db, {})).toThrow(/ALLOW_REMOTE/);
    expect(() =>
      createRemoteOperationalPersistence(db, { BEAUTY_OS_PERSISTENCE: "supabase" }),
    ).toThrow(/ALLOW_REMOTE/);
    expect(createRemoteOperationalPersistence(db, REMOTE_FLAGS).driver).toBe("supabase");
    expect(getOperationalPersistence({}).driver).toBe("local");
    expect(getOperationalPersistence(REMOTE_FLAGS).driver).toBe("supabase");
  });
});
