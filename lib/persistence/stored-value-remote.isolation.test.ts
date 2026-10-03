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
  seedTwoOrgs,
} from "./test-identity-fixture";

function sumDelta(entries: { amountDelta: number }[]) {
  return entries.reduce((sum, e) => sum + e.amountDelta, 0);
}

describe("Phase 5A-2 stored-value remote round-trip", () => {
  it("TOP_UP +10000, PAYMENT -2800, duplicate effect_key stays 7200, reversal returns 10000 via SUM", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);

    const top = await remote.storedValue.postTopUp(ORG_A, {
      customerId: CUST_SHARED,
      amount: 10000,
      transactionId: "txn-top",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: "txn-top:STORED_VALUE_TOP_UP:i",
    });
    expect(Number.isInteger(top.amountDelta)).toBe(true);
    expect("balance" in top).toBe(false);

    let ledger = await remote.storedValue.listLedger(ORG_A, { customerId: CUST_SHARED });
    expect(await remote.storedValue.customerBalance(ORG_A, CUST_SHARED)).toBe(sumDelta(ledger));
    expect(sumDelta(ledger)).toBe(10000);

    const pay = await remote.storedValue.postPayment(ORG_A, {
      customerId: CUST_SHARED,
      amount: 2800,
      transactionId: "txn-pay",
      locationId: LOC_A2,
      createdByStaffId: STAFF_A,
      effectKey: "txn-pay:STORED_VALUE_PAYMENT:p",
    });
    expect(pay.locationId).toBe(LOC_A2);

    ledger = await remote.storedValue.listLedger(ORG_A, { customerId: CUST_SHARED });
    expect(await remote.storedValue.customerBalance(ORG_A, CUST_SHARED)).toBe(sumDelta(ledger));
    expect(sumDelta(ledger)).toBe(7200);

    const retry = await remote.storedValue.postPayment(ORG_A, {
      customerId: CUST_SHARED,
      amount: 2800,
      transactionId: "txn-pay",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: "txn-pay:STORED_VALUE_PAYMENT:p",
    });
    expect(retry.id).toBe(pay.id);
    ledger = await remote.storedValue.listLedger(ORG_A, { customerId: CUST_SHARED });
    expect(sumDelta(ledger)).toBe(7200);

    await remote.storedValue.reverseLedgerEntry(ORG_A, pay.id, STAFF_A);
    ledger = await remote.storedValue.listLedger(ORG_A, { customerId: CUST_SHARED });
    expect(await remote.storedValue.customerBalance(ORG_A, CUST_SHARED)).toBe(sumDelta(ledger));
    expect(sumDelta(ledger)).toBe(10000);
  });

  it("ADJUSTMENT appends integer delta and remaining is still SUM", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await remote.storedValue.postTopUp(ORG_A, {
      customerId: CUST_SHARED,
      amount: 1000,
      transactionId: "txn-adj-top",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: "txn-adj-top:STORED_VALUE_TOP_UP:i",
    });
    await remote.storedValue.postAdjustment(ORG_A, {
      customerId: CUST_SHARED,
      amountDelta: -200,
      reason: "correction",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: "adj-1:STORED_VALUE_ADJUSTMENT",
    });
    const ledger = await remote.storedValue.listLedger(ORG_A, { customerId: CUST_SHARED });
    expect(ledger.some((e) => e.type === "ADJUSTMENT")).toBe(true);
    expect(await remote.storedValue.customerBalance(ORG_A, CUST_SHARED)).toBe(sumDelta(ledger));
    expect(sumDelta(ledger)).toBe(800);
  });

  it("does not location-scope stored-value balance", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await remote.storedValue.postTopUp(ORG_A, {
      customerId: CUST_SHARED,
      amount: 5000,
      transactionId: "txn-l1",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: "txn-l1:STORED_VALUE_TOP_UP:i",
    });
    await remote.storedValue.postPayment(ORG_A, {
      customerId: CUST_SHARED,
      amount: 200,
      transactionId: "txn-l2",
      locationId: LOC_A2,
      createdByStaffId: STAFF_A,
      effectKey: "txn-l2:STORED_VALUE_PAYMENT:p",
    });
    const ledger = await remote.storedValue.listLedger(ORG_A, { customerId: CUST_SHARED });
    expect(new Set(ledger.map((e) => e.locationId))).toEqual(new Set([LOC_A1, LOC_A2]));
    expect(sumDelta(ledger)).toBe(4800);
  });

  it("isolates identical customer app_id and effect_key across orgs", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const key = "same-sv:STORED_VALUE_TOP_UP:i";
    await remote.storedValue.postTopUp(ORG_A, {
      customerId: CUST_SHARED,
      amount: 10000,
      transactionId: "txn-a",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: key,
    });
    await remote.storedValue.postTopUp(ORG_B, {
      customerId: CUST_SHARED,
      amount: 3000,
      transactionId: "txn-b",
      locationId: LOC_B1,
      createdByStaffId: STAFF_B,
      effectKey: key,
    });
    expect(sumDelta(await remote.storedValue.listLedger(ORG_A))).toBe(10000);
    expect(sumDelta(await remote.storedValue.listLedger(ORG_B))).toBe(3000);
  });
});

describe("Phase 5A-2 stored-value failure paths", () => {
  it("fails closed on missing customer, missing staff, insufficient balance", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);

    await expect(
      remote.storedValue.postTopUp(ORG_A, {
        customerId: "cust-missing",
        amount: 100,
        transactionId: "t",
        locationId: LOC_A1,
        createdByStaffId: STAFF_A,
        effectKey: "t:STORED_VALUE_TOP_UP:i",
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);

    await expect(
      remote.storedValue.postTopUp(ORG_A, {
        customerId: CUST_SHARED,
        amount: 100,
        transactionId: "t",
        locationId: LOC_A1,
        createdByStaffId: "staff-missing",
        effectKey: "t:STORED_VALUE_TOP_UP:i",
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);

    await remote.storedValue.postTopUp(ORG_A, {
      customerId: CUST_SHARED,
      amount: 100,
      transactionId: "txn-small",
      locationId: LOC_A1,
      createdByStaffId: STAFF_A,
      effectKey: "txn-small:STORED_VALUE_TOP_UP:i",
    });
    await expect(
      remote.storedValue.postPayment(ORG_A, {
        customerId: CUST_SHARED,
        amount: 2800,
        transactionId: "txn-over",
        locationId: LOC_A1,
        createdByStaffId: STAFF_A,
        effectKey: "txn-over:STORED_VALUE_PAYMENT:p",
      }),
    ).rejects.toThrow(/insufficient/i);
    expect(sumDelta(await remote.storedValue.listLedger(ORG_A, { customerId: CUST_SHARED }))).toBe(
      100,
    );
  });
});
