/**
 * Phase 4.10C — Inventory movement ledger + sale/void integration tests.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  createEmptyCheckoutDraft,
  getCheckoutDraft,
  setCheckoutPayments,
  setPackageRedemption,
  updateCheckoutItemQuantity,
} from "@/lib/commerce/checkout-store";
import { getTransaction, listTransactions } from "@/lib/commerce/transaction-store";
import { voidTransaction } from "@/lib/commerce/void-transaction";
import { effectKey } from "@/lib/commerce/settle-effects";
import {
  createAppointment,
  transitionAppointmentStatus,
} from "@/lib/appointments/store";
import {
  createCustomerPackageFromPurchase,
  createPackageDefinition,
  getPackageLedgerBalance,
} from "@/lib/packages/store";
import { createProduct, deactivateProduct } from "@/lib/products/store";
import {
  adjustInventory,
  canActorManageInventory,
  getProductStock,
  listInventoryMovements,
  listProductInventoryAcrossLocations,
  receiveStock,
} from "@/lib/inventory/store";
import { getInventoryMovementsKey } from "@/lib/tenant/storage-keys";
import {
  getCustomerStoredValueBalance,
  getOrCreateStoredValueAccount,
  listStoredValueLedger,
  postStoredValueTopUp,
} from "@/lib/stored-value/store";

beforeEach(() => {
  localStorage.clear();
});

function product(
  patch?: Partial<Parameters<typeof createProduct>[1]> & { name?: string },
) {
  return createProduct(ORG_ENJOYE_ID, {
    name: patch?.name ?? "居家按摩霜",
    sku: patch?.sku ?? `SKU-${Math.random().toString(36).slice(2, 8)}`,
    priceMinor: patch?.priceMinor ?? 800,
    barcode: patch?.barcode,
    createdByStaffId: patch?.createdByStaffId ?? "staff-001",
    isActive: patch?.isActive,
  });
}

function payCash(draftId: string, total: number) {
  setCheckoutPayments(ORG_ENJOYE_ID, draftId, [{ method: "CASH", amount: total }]);
}

function stock(
  productId: string,
  quantity: number,
  locationId = LOC_ENJOYE_PRIMARY_ID,
) {
  return receiveStock(ORG_ENJOYE_ID, {
    productId,
    locationId,
    quantity,
    createdByStaffId: "staff-001",
  });
}

describe("inventory domain", () => {
  it("receive creates + movement; stock derived from SUM", () => {
    const p = product();
    stock(p.id, 20);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(20);
    const moves = listInventoryMovements(ORG_ENJOYE_ID, {
      productId: p.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
    });
    expect(moves).toHaveLength(1);
    expect(moves[0].type).toBe("RECEIVE");
    expect(moves[0].quantityDelta).toBe(20);
  });

  it("adjustment +/− works; negative blocked; reason required", () => {
    const p = product({ sku: "ADJ-1" });
    stock(p.id, 10);
    adjustInventory(ORG_ENJOYE_ID, {
      productId: p.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantityDelta: 1,
      reason: "盤點多 1",
      createdByStaffId: "staff-001",
    });
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(11);
    adjustInventory(ORG_ENJOYE_ID, {
      productId: p.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantityDelta: -2,
      reason: "盤點少 2",
      createdByStaffId: "staff-001",
    });
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(9);
    expect(() =>
      adjustInventory(ORG_ENJOYE_ID, {
        productId: p.id,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        quantityDelta: -100,
        reason: "壞掉",
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/負/);
    expect(() =>
      adjustInventory(ORG_ENJOYE_ID, {
        productId: p.id,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        quantityDelta: -1,
        reason: "   ",
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/reason/);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(9);
  });

  it("stock differs by location; org total does not authorize sale", () => {
    const p = product({ sku: "LOC-STOCK" });
    stock(p.id, 10, LOC_ENJOYE_PRIMARY_ID);
    stock(p.id, 4, LOC_ENJOYE_SECONDARY_ID);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(10);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_SECONDARY_ID, p.id)).toBe(4);
    expect(
      listProductInventoryAcrossLocations(ORG_ENJOYE_ID, p.id).reduce(
        (s, r) => s + r.stock,
        0,
      ),
    ).toBe(14);

    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_SECONDARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    expect(() =>
      addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
        type: "PRODUCT",
        referenceId: p.id,
        name: "",
        unitPrice: 0,
        quantity: 5,
      }),
    ).toThrow(/庫存不足/);
  });

  it("tenant isolation and same-ID safety", () => {
    const p = product({ sku: "TEN-I" });
    stock(p.id, 5);
    expect(getProductStock(ORG_LUMIERE_ID, LOC_LUMIERE_PRIMARY_ID, p.id)).toBe(0);
    expect(listInventoryMovements(ORG_LUMIERE_ID)).toHaveLength(0);
    expect(() =>
      receiveStock(ORG_LUMIERE_ID, {
        productId: p.id,
        locationId: LOC_LUMIERE_PRIMARY_ID,
        quantity: 1,
        createdByStaffId: "staff-001",
      }),
    ).toThrow();
    localStorage.setItem(
      getInventoryMovementsKey(ORG_LUMIERE_ID),
      JSON.stringify([
        {
          id: "inv-same",
          organizationId: ORG_LUMIERE_ID,
          locationId: LOC_LUMIERE_PRIMARY_ID,
          productId: p.id,
          type: "RECEIVE",
          quantityDelta: 99,
          createdAt: new Date().toISOString(),
          createdByStaffId: "staff-lumiere-01",
        },
      ]),
    );
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(5);
  });

  it("OWNER manage allowed; STAFF adjustment rejected", () => {
    expect(canActorManageInventory(ORG_ENJOYE_ID, "staff-001")).toBe(true);
    expect(canActorManageInventory(ORG_ENJOYE_ID, "staff-002")).toBe(false);
    const p = product({ sku: "RBAC-I" });
    expect(() =>
      receiveStock(ORG_ENJOYE_ID, {
        productId: p.id,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        quantity: 1,
        createdByStaffId: "staff-002",
      }),
    ).toThrow(/Unauthorized/);
  });

  it("inactive product stock still queryable; cannot sell", () => {
    const p = product({ sku: "INACT" });
    stock(p.id, 3);
    deactivateProduct(ORG_ENJOYE_ID, p.id, "staff-001");
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(3);
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    expect(() =>
      addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
        type: "PRODUCT",
        referenceId: p.id,
        name: "",
        unitPrice: 0,
      }),
    ).toThrow(/inactive/);
  });
});

describe("inventory sale + settle", () => {
  it("sale deducts qty; zero stock blocks add; oversell qty blocked", () => {
    const p = product({ sku: "SALE-1", priceMinor: 800 });
    stock(p.id, 1);

    const emptyLoc = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_SECONDARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    expect(() =>
      addCheckoutItem(ORG_ENJOYE_ID, emptyLoc.id, {
        type: "PRODUCT",
        referenceId: p.id,
        name: "",
        unitPrice: 0,
      }),
    ).toThrow(/缺貨|庫存/);

    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const withItem = addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
      quantity: 1,
    });
    expect(() =>
      updateCheckoutItemQuantity(
        ORG_ENJOYE_ID,
        draft.id,
        withItem.items[0].id,
        2,
      ),
    ).toThrow(/庫存不足/);

    payCash(draft.id, 800);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(0);
    expect(
      listInventoryMovements(ORG_ENJOYE_ID, { transactionId: tx.id }).filter(
        (m) => m.type === "SALE",
      )[0].quantityDelta,
    ).toBe(-1);

    const blocked = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    expect(() =>
      addCheckoutItem(ORG_ENJOYE_ID, blocked.id, {
        type: "PRODUCT",
        referenceId: p.id,
        name: "",
        unitPrice: 0,
      }),
    ).toThrow(/缺貨/);
  });

  it("insufficient stock at complete creates no TX / SV / package effects", () => {
    const p = product({ sku: "FAIL-SAFE", priceMinor: 800 });
    stock(p.id, 1);
    getOrCreateStoredValueAccount(ORG_ENJOYE_ID, "demo-001", "staff-001");
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 5000,
      transactionId: "txn-seed-inv-sv",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed-inv-sv:STORED_VALUE_TOP_UP:i",
    });
    const def = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "pkg",
      includedServiceIds: ["svc-breast"],
      sessionCount: 5,
      priceMinor: 10000,
      createdByStaffId: "staff-001",
    });
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-seed-inv-pkg",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed-inv-pkg:PACKAGE_PURCHASE:i",
    });

    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "SERVICE",
      referenceId: "svc-breast",
      name: "",
      unitPrice: 0,
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
      quantity: 1,
    });
    setPackageRedemption(ORG_ENJOYE_ID, draft.id, {
      customerPackageId: customerPackage.id,
      serviceId: "svc-breast",
      sessions: 1,
    });
    // Drain stock after draft built
    const drain = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, drain.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
      quantity: 1,
    });
    payCash(drain.id, 800);
    completeCheckout(ORG_ENJOYE_ID, drain.id);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(0);

    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "CASH", amount: 800 },
    ]);
    const beforeTx = listTransactions(ORG_ENJOYE_ID).length;
    expect(() => completeCheckout(ORG_ENJOYE_ID, draft.id)).toThrow(/庫存不足/);
    expect(listTransactions(ORG_ENJOYE_ID)).toHaveLength(beforeTx);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(5);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(5000);
    expect(listStoredValueLedger(ORG_ENJOYE_ID).filter((e) => e.type === "PAYMENT")).toHaveLength(
      0,
    );
  });

  it("quantity 2 deducts 2; mixed service+product; package redemption unaffected", () => {
    const p = product({ sku: "QTY2", priceMinor: 800 });
    stock(p.id, 10);
    const def = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "pkg2",
      includedServiceIds: ["svc-breast"],
      sessionCount: 10,
      priceMinor: 18000,
      createdByStaffId: "staff-001",
    });
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-seed-inv-pkg2",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed-inv-pkg2:PACKAGE_PURCHASE:i",
    });
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "SERVICE",
      referenceId: "svc-breast",
      name: "",
      unitPrice: 0,
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
      quantity: 2,
    });
    setPackageRedemption(ORG_ENJOYE_ID, draft.id, {
      customerPackageId: customerPackage.id,
      serviceId: "svc-breast",
      sessions: 1,
    });
    payCash(draft.id, 1600);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(8);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(9);
    const sales = listInventoryMovements(ORG_ENJOYE_ID, {
      transactionId: tx.id,
    }).filter((m) => m.type === "SALE");
    expect(sales).toHaveLength(1);
    expect(sales[0].quantityDelta).toBe(-2);
  });

  it("same product multiple cart rows aggregate validation; per-item SALE", () => {
    const p = product({ sku: "AGG", priceMinor: 100 });
    stock(p.id, 5);
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
      quantity: 2,
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
      quantity: 3,
    });
    payCash(draft.id, 500);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(0);
    expect(
      listInventoryMovements(ORG_ENJOYE_ID, { transactionId: tx.id }).filter(
        (m) => m.type === "SALE",
      ),
    ).toHaveLength(2);

    stock(p.id, 4);
    const over = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, over.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
      quantity: 2,
    });
    expect(() =>
      addCheckoutItem(ORG_ENJOYE_ID, over.id, {
        type: "PRODUCT",
        referenceId: p.id,
        name: "",
        unitPrice: 0,
        quantity: 3,
      }),
    ).toThrow(/庫存不足/);
  });

  it("retry settle does not double deduct; effectKey deterministic", () => {
    const p = product({ sku: "IDEM", priceMinor: 800 });
    stock(p.id, 5);
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const withItem = addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
      quantity: 1,
    });
    payCash(draft.id, 800);
    const tx1 = completeCheckout(ORG_ENJOYE_ID, draft.id);
    const tx2 = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx2.id).toBe(tx1.id);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(4);
    const sales = listInventoryMovements(ORG_ENJOYE_ID, {
      transactionId: tx1.id,
    }).filter((m) => m.type === "SALE");
    expect(sales).toHaveLength(1);
    expect(sales[0].effectKey).toBe(
      effectKey(tx1.id, "INVENTORY_SALE", withItem.items[0].id),
    );
  });

  it("general retail + appointment checkout use explicit sale locations", () => {
    const p = product({ sku: "APT-LOC" });
    stock(p.id, 5, LOC_ENJOYE_PRIMARY_ID);
    stock(p.id, 5, LOC_ENJOYE_SECONDARY_ID);

    const retail = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_SECONDARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, retail.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
    });
    payCash(retail.id, 800);
    const txR = completeCheckout(ORG_ENJOYE_ID, retail.id);
    expect(txR.locationId).toBe(LOC_ENJOYE_SECONDARY_ID);
    expect(
      listInventoryMovements(ORG_ENJOYE_ID, { transactionId: txR.id })[0]
        .locationId,
    ).toBe(LOC_ENJOYE_SECONDARY_ID);

    const apt = createAppointment(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      serviceId: "svc-breast",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      startAt: "2026-09-24T10:00:00+08:00",
      endAt: "2026-09-24T11:40:00+08:00",
      createdBy: "staff-001",
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "ARRIVED", "staff-001");
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "IN_SERVICE", "staff-001");
    const fromApt = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, fromApt.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
    });
    const d = getCheckoutDraft(ORG_ENJOYE_ID, fromApt.id)!;
    payCash(fromApt.id, d.total);
    const txA = completeCheckout(ORG_ENJOYE_ID, fromApt.id);
    expect(txA.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    const sale = listInventoryMovements(ORG_ENJOYE_ID, {
      transactionId: txA.id,
    }).find((m) => m.type === "SALE")!;
    expect(sale.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
  });

  it("SV payment + inventory; void restores stock; SALE unchanged; retry safe", () => {
    const p = product({ sku: "VOID-INV", priceMinor: 1500 });
    stock(p.id, 10);
    getOrCreateStoredValueAccount(ORG_ENJOYE_ID, "demo-001", "staff-001");
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 5000,
      transactionId: "txn-seed-void-inv",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed-void-inv:STORED_VALUE_TOP_UP:i",
    });
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: p.id,
      name: "",
      unitPrice: 0,
      quantity: 2,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "STORED_VALUE", amount: 1500 },
      { method: "CASH", amount: 1500 },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(8);
    const sale = listInventoryMovements(ORG_ENJOYE_ID, {
      transactionId: tx.id,
    }).find((m) => m.type === "SALE")!;

    const once = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "結錯帳",
    });
    expect(once.inventoryReversals).toHaveLength(1);
    expect(once.inventoryReversals[0].reversesMovementId).toBe(sale.id);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(10);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(5000);
    expect(
      listInventoryMovements(ORG_ENJOYE_ID).find((m) => m.id === sale.id)
        ?.quantityDelta,
    ).toBe(-2);

    voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "再試",
    });
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(10);
    expect(
      listInventoryMovements(ORG_ENJOYE_ID, { transactionId: tx.id }).filter(
        (m) => m.type === "REVERSAL",
      ),
    ).toHaveLength(1);
    expect(getTransaction(ORG_ENJOYE_ID, tx.id)!.items[0].quantity).toBe(2);
  });

  it("movement history filters location/product", () => {
    const p = product({ sku: "HIST" });
    stock(p.id, 3);
    adjustInventory(ORG_ENJOYE_ID, {
      productId: p.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantityDelta: -1,
      reason: "盤點",
      createdByStaffId: "staff-001",
    });
    const hist = listInventoryMovements(ORG_ENJOYE_ID, {
      productId: p.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
    });
    expect(hist).toHaveLength(2);
    expect(new Set(hist.map((m) => m.type))).toEqual(
      new Set(["RECEIVE", "ADJUSTMENT"]),
    );
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, p.id)).toBe(2);
    expect(
      listInventoryMovements(ORG_ENJOYE_ID, {
        locationId: LOC_ENJOYE_SECONDARY_ID,
      }),
    ).toHaveLength(0);
  });
});
