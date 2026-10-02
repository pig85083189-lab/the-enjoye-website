import { describe, expect, it } from "vitest";
import { UnmappedIdentityError } from "./identity-errors";
import { createMemoryRemotePersistence } from "./remote-factory";
import {
  CUST_SHARED,
  LOC_A1,
  LOC_A2,
  LOC_B1,
  ORG_A,
  ORG_B,
  STAFF_A,
  STAFF_B,
  SVC_SHARED,
  seedTwoOrgs,
} from "./test-identity-fixture";

function sumSessions(entries: { sessionDelta: number }[]) {
  return entries.reduce((sum, e) => sum + e.sessionDelta, 0);
}

describe("Phase 5A-2 package remote round-trip", () => {
  it("purchase +10, redeem -1, duplicate effect_key stays 9, reversal returns 10 — all via ledger SUM", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const def = await remote.packages.createDefinition(ORG_A, {
      name: "十堂",
      includedServiceIds: [SVC_SHARED],
      sessionCount: 10,
      priceMinor: 18000,
      createdByStaffId: STAFF_A,
    });
    expect("remainingSessions" in def).toBe(false);
    expect(Number.isInteger(def.priceMinor)).toBe(true);

    const { customerPackage } = await remote.packages.createPurchasedPackage(ORG_A, {
      customerId: CUST_SHARED,
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-buy",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: "txn-buy:PACKAGE_PURCHASE:i",
    });
    expect("remainingSessions" in customerPackage).toBe(false);
    expect(customerPackage.nameSnapshot).toBe("十堂");
    expect(customerPackage.sessionCountSnapshot).toBe(10);
    expect(customerPackage.priceSnapshot).toBe(18000);

    const afterPurchase = await remote.packages.listLedger(ORG_A, {
      customerPackageId: customerPackage.id,
    });
    expect(await remote.packages.ledgerBalance(ORG_A, customerPackage.id)).toBe(
      sumSessions(afterPurchase),
    );
    expect(sumSessions(afterPurchase)).toBe(10);

    const redeem = await remote.packages.redeemSession(ORG_A, {
      customerPackageId: customerPackage.id,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      locationId: LOC_A2,
      transactionId: "txn-use",
      createdByStaffId: STAFF_A,
      effectKey: "txn-use:PACKAGE_REDEMPTION:cp",
    });
    expect(redeem.locationId).toBe(LOC_A2);

    const afterRedeem = await remote.packages.listLedger(ORG_A, {
      customerPackageId: customerPackage.id,
    });
    expect(await remote.packages.ledgerBalance(ORG_A, customerPackage.id)).toBe(
      sumSessions(afterRedeem),
    );
    expect(sumSessions(afterRedeem)).toBe(9);

    const retry = await remote.packages.redeemSession(ORG_A, {
      customerPackageId: customerPackage.id,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      locationId: LOC_A1,
      transactionId: "txn-use",
      createdByStaffId: STAFF_A,
      effectKey: "txn-use:PACKAGE_REDEMPTION:cp",
    });
    expect(retry.id).toBe(redeem.id);
    expect(
      sumSessions(
        await remote.packages.listLedger(ORG_A, { customerPackageId: customerPackage.id }),
      ),
    ).toBe(9);

    await remote.packages.reverseLedgerEntry(ORG_A, redeem.id, STAFF_A);
    const afterReversal = await remote.packages.listLedger(ORG_A, {
      customerPackageId: customerPackage.id,
    });
    expect(await remote.packages.ledgerBalance(ORG_A, customerPackage.id)).toBe(
      sumSessions(afterReversal),
    );
    expect(sumSessions(afterReversal)).toBe(10);
  });

  it("keeps remaining organization-wide across locations", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const def = await remote.packages.createDefinition(ORG_A, {
      name: "十堂",
      includedServiceIds: [SVC_SHARED],
      sessionCount: 10,
      priceMinor: 18000,
      createdByStaffId: STAFF_A,
    });
    const { customerPackage } = await remote.packages.createPurchasedPackage(ORG_A, {
      customerId: CUST_SHARED,
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-loc",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: "txn-loc:PACKAGE_PURCHASE:i",
    });
    await remote.packages.redeemSession(ORG_A, {
      customerPackageId: customerPackage.id,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      locationId: LOC_A2,
      transactionId: "txn-loc-r",
      createdByStaffId: STAFF_A,
      effectKey: "txn-loc-r:PACKAGE_REDEMPTION:cp",
    });
    const all = await remote.packages.listLedger(ORG_A, {
      customerPackageId: customerPackage.id,
    });
    expect(new Set(all.map((e) => e.locationId))).toEqual(new Set([LOC_A1, LOC_A2]));
    expect(sumSessions(all)).toBe(9);
  });

  it("isolates identical customer app_id and effect_key across orgs", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const defA = await remote.packages.createDefinition(ORG_A, {
      name: "A",
      includedServiceIds: [SVC_SHARED],
      sessionCount: 10,
      priceMinor: 1000,
      createdByStaffId: STAFF_A,
    });
    const defB = await remote.packages.createDefinition(ORG_B, {
      name: "B",
      includedServiceIds: [SVC_SHARED],
      sessionCount: 8,
      priceMinor: 800,
      createdByStaffId: STAFF_B,
    });
    const key = "same-effect-key:PACKAGE_PURCHASE:i";
    await remote.packages.createPurchasedPackage(ORG_A, {
      customerId: CUST_SHARED,
      packageDefinitionId: defA.id,
      purchaseTransactionId: "txn-a",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: key,
    });
    await remote.packages.createPurchasedPackage(ORG_B, {
      customerId: CUST_SHARED,
      packageDefinitionId: defB.id,
      purchaseTransactionId: "txn-b",
      locationId: LOC_B1,
      createdByStaffId: STAFF_B,
      effectKey: key,
    });
    const ledgerA = await remote.packages.listLedger(ORG_A);
    const ledgerB = await remote.packages.listLedger(ORG_B);
    expect(sumSessions(ledgerA)).toBe(10);
    expect(sumSessions(ledgerB)).toBe(8);
    expect(ledgerA.every((e) => e.organizationId === ORG_A)).toBe(true);
    expect(ledgerB.every((e) => e.organizationId === ORG_B)).toBe(true);
  });
});

describe("Phase 5A-2 package failure paths", () => {
  it("fails closed on missing mappings, wrong org, expired package", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);

    await expect(
      remote.packages.createDefinition(ORG_A, {
        name: "x",
        includedServiceIds: [SVC_SHARED],
        sessionCount: 10,
        priceMinor: 1,
        createdByStaffId: "staff-missing",
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);

    await expect(
      remote.packages.createDefinition(ORG_A, {
        name: "x",
        includedServiceIds: ["svc-missing"],
        sessionCount: 10,
        priceMinor: 1,
        createdByStaffId: STAFF_A,
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);

    const def = await remote.packages.createDefinition(ORG_A, {
      name: "x",
      includedServiceIds: [SVC_SHARED],
      sessionCount: 10,
      priceMinor: 1,
      createdByStaffId: STAFF_A,
    });

    await expect(
      remote.packages.createPurchasedPackage(ORG_B, {
        customerId: CUST_SHARED,
        packageDefinitionId: def.id,
        purchaseTransactionId: "txn-wrong",
        locationId: LOC_B1,
        createdByStaffId: STAFF_B,
        effectKey: "txn-wrong:PACKAGE_PURCHASE:i",
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);

    const { customerPackage, entry } = await remote.packages.createPurchasedPackage(ORG_A, {
      customerId: CUST_SHARED,
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-ok",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: "txn-ok:PACKAGE_PURCHASE:i",
    });
    db.expireCustomerPackage(
      db.customerPackages.find((p) => p.app_id === customerPackage.id)!.id,
      "2000-01-01T00:00:00.000Z",
    );
    await expect(
      remote.packages.redeemSession(ORG_A, {
        customerPackageId: customerPackage.id,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        locationId: LOC_A1,
        transactionId: "txn-exp",
        createdByStaffId: STAFF_A,
        effectKey: "txn-exp:PACKAGE_REDEMPTION:cp",
      }),
    ).rejects.toThrow(/expired/i);

    expect(sumSessions(await remote.packages.listLedger(ORG_A))).toBe(entry.sessionDelta);
  });
});
