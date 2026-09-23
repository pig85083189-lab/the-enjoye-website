/**
 * Phase 4.10B — Product catalog + retail checkout isolation tests.
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
  createEmptyCheckoutDraft,
  setCheckoutPayments,
  setPackageRedemption,
  updateCheckoutItemQuantity,
} from "@/lib/commerce/checkout-store";
import { getTransaction, listTransactions } from "@/lib/commerce/transaction-store";
import { voidTransaction } from "@/lib/commerce/void-transaction";
import {
  createCustomerPackageFromPurchase,
  createPackageDefinition,
  getPackageLedgerBalance,
  listPackageLedger,
} from "@/lib/packages/store";
import {
  createProduct,
  deactivateProduct,
  getProductById,
  listProducts,
  searchProducts,
  updateProduct,
} from "@/lib/products/store";
import { receiveStock } from "@/lib/inventory/store";
import { getProductsKey } from "@/lib/tenant/storage-keys";
import {
  getCustomerStoredValueBalance,
  getOrCreateStoredValueAccount,
  listStoredValueLedger,
  postStoredValueTopUp,
} from "@/lib/stored-value/store";

beforeEach(() => {
  localStorage.clear();
});

function payCash(orgId: string, draftId: string, total: number) {
  setCheckoutPayments(orgId, draftId, [{ method: "CASH", amount: total }]);
}

function makeProduct(
  orgId = ORG_ENJOYE_ID,
  patch?: Partial<Parameters<typeof createProduct>[1]> & {
    stock?: number;
    stockLocationId?: string;
  },
) {
  const { stock, stockLocationId, ...createPatch } = patch ?? {};
  const p = createProduct(orgId, {
    name: createPatch.name ?? "居家按摩霜",
    sku: createPatch.sku ?? "SKU-CREAM-01",
    barcode: createPatch.barcode ?? "4710001111111",
    category: createPatch.category ?? "居家保養",
    priceMinor: createPatch.priceMinor ?? 800,
    description: createPatch.description,
    isActive: createPatch.isActive,
    createdByStaffId: createPatch.createdByStaffId ?? "staff-001",
  });
  const qty = stock ?? (orgId === ORG_ENJOYE_ID ? 50 : 0);
  if (qty > 0) {
    receiveStock(orgId, {
      productId: p.id,
      locationId:
        stockLocationId ??
        (orgId === ORG_ENJOYE_ID ? LOC_ENJOYE_PRIMARY_ID : LOC_LUMIERE_PRIMARY_ID),
      quantity: qty,
      createdByStaffId: createPatch.createdByStaffId ?? "staff-001",
    });
  }
  return p;
}

describe("product domain", () => {
  it("creates, updates, and deactivates products", () => {
    const p = makeProduct();
    expect(p.organizationId).toBe(ORG_ENJOYE_ID);
    expect(p.priceMinor).toBe(800);
    expect(p.isActive).toBe(true);

    const updated = updateProduct(
      ORG_ENJOYE_ID,
      p.id,
      { name: "居家按摩霜加強版", priceMinor: 900 },
      "staff-001",
    );
    expect(updated.name).toBe("居家按摩霜加強版");
    expect(updated.priceMinor).toBe(900);

    const off = deactivateProduct(ORG_ENJOYE_ID, p.id, "staff-001");
    expect(off.isActive).toBe(false);
    expect(listProducts(ORG_ENJOYE_ID, { activeOnly: true })).toHaveLength(0);
  });

  it("rejects negative / non-integer price", () => {
    expect(() =>
      createProduct(ORG_ENJOYE_ID, {
        name: "x",
        priceMinor: -1,
        createdByStaffId: "staff-001",
      }),
    ).toThrow();
    expect(() =>
      createProduct(ORG_ENJOYE_ID, {
        name: "x",
        priceMinor: 10.5,
        createdByStaffId: "staff-001",
      }),
    ).toThrow();
  });

  it("duplicate SKU same org rejected; same SKU different org allowed", () => {
    makeProduct(ORG_ENJOYE_ID, { sku: "SHARED-SKU" });
    expect(() =>
      makeProduct(ORG_ENJOYE_ID, { sku: "SHARED-SKU", name: "other" }),
    ).toThrow(/SKU/);

    // Lumiere has no OWNER/MANAGER seed actor — write org-scoped catalog row directly.
    const now = new Date().toISOString();
    localStorage.setItem(
      getProductsKey(ORG_LUMIERE_ID),
      JSON.stringify([
        {
          id: "prd-lumiere-shared",
          organizationId: ORG_LUMIERE_ID,
          name: "Lumiere cream",
          sku: "SHARED-SKU",
          priceMinor: 800,
          currency: "TWD",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ]),
    );
    const other = getProductById(ORG_LUMIERE_ID, "prd-lumiere-shared");
    expect(other?.sku).toBe("SHARED-SKU");
    expect(other?.organizationId).toBe(ORG_LUMIERE_ID);
  });

  it("tenant isolation and same-ID safety", () => {
    const a = makeProduct(ORG_ENJOYE_ID, { sku: "A1" });
    expect(getProductById(ORG_LUMIERE_ID, a.id)).toBeUndefined();
    expect(listProducts(ORG_LUMIERE_ID).some((p) => p.id === a.id)).toBe(false);
    expect(() =>
      updateProduct(ORG_LUMIERE_ID, a.id, { name: "hack" }, "staff-001"),
    ).toThrow();
    expect(() =>
      deactivateProduct(ORG_LUMIERE_ID, a.id, "staff-001"),
    ).toThrow();
    localStorage.setItem(
      getProductsKey(ORG_LUMIERE_ID),
      JSON.stringify([{ ...a, organizationId: ORG_LUMIERE_ID, name: "leak?" }]),
    );
    expect(getProductById(ORG_ENJOYE_ID, a.id)?.name).toBe("居家按摩霜");
  });

  it("search by name, sku, barcode", () => {
    makeProduct(ORG_ENJOYE_ID, {
      name: "臉部精華",
      sku: "FACE-01",
      barcode: "888111222333",
    });
    expect(searchProducts(ORG_ENJOYE_ID, "精華")[0]?.sku).toBe("FACE-01");
    expect(searchProducts(ORG_ENJOYE_ID, "face-01")[0]?.name).toBe("臉部精華");
    expect(searchProducts(ORG_ENJOYE_ID, "888111222333")[0]?.sku).toBe("FACE-01");
  });

  it("unauthorized staff cannot manage products", () => {
    expect(() =>
      createProduct(ORG_ENJOYE_ID, {
        name: "x",
        priceMinor: 100,
        createdByStaffId: "staff-002",
      }),
    ).toThrow(/Unauthorized/);
  });
});

describe("retail checkout products", () => {
  it("adds product with price snapshot and quantity math", () => {
    const product = makeProduct();
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const withItem = addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: product.id,
      name: "ignored",
      unitPrice: 1,
      quantity: 2,
    });
    const item = withItem.items[0];
    expect(item.type).toBe("PRODUCT");
    expect(item.referenceId).toBe(product.id);
    expect(item.nameSnapshot).toBe("居家按摩霜");
    expect(item.unitPrice).toBe(800);
    expect(item.quantity).toBe(2);
    expect(item.lineTotal).toBe(1600);
    expect(withItem.total).toBe(1600);
    expect(withItem.appointmentId).toBeUndefined();
  });

  it("inactive product cannot be added; rename/price change does not alter TX snapshot", () => {
    const product = makeProduct();
    const live = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const d1 = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, d1.id, {
      type: "PRODUCT",
      referenceId: product.id,
      name: "",
      unitPrice: 0,
      quantity: 1,
    });
    payCash(ORG_ENJOYE_ID, d1.id, 800);
    const tx = completeCheckout(ORG_ENJOYE_ID, d1.id);

    updateProduct(
      ORG_ENJOYE_ID,
      product.id,
      { name: "新名稱", priceMinor: 1200 },
      "staff-001",
    );
    deactivateProduct(ORG_ENJOYE_ID, product.id, "staff-001");

    const saved = getTransaction(ORG_ENJOYE_ID, tx.id)!;
    expect(saved.items[0].nameSnapshot).toBe("居家按摩霜");
    expect(saved.items[0].unitPrice).toBe(800);
    expect(saved.items[0].type).toBe("PRODUCT");

    expect(() =>
      addCheckoutItem(ORG_ENJOYE_ID, live.id, {
        type: "PRODUCT",
        referenceId: product.id,
        name: "",
        unitPrice: 0,
      }),
    ).toThrow(/inactive/);

    expect(
      listTransactions(ORG_ENJOYE_ID, { customerId: "demo-001" }).some(
        (t) => t.id === tx.id,
      ),
    ).toBe(true);
  });

  it("mixed SERVICE + PRODUCT cart; package cannot redeem PRODUCT", () => {
    const product = makeProduct(ORG_ENJOYE_ID, { priceMinor: 800, sku: "MIX-1" });
    const def = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 10,
      priceMinor: 18000,
      createdByStaffId: "staff-001",
    });
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-seed-pkg-mix",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed-pkg-mix:PACKAGE_PURCHASE:i",
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
      referenceId: product.id,
      name: "",
      unitPrice: 0,
      quantity: 1,
    });
    const withRedeem = setPackageRedemption(ORG_ENJOYE_ID, draft.id, {
      customerPackageId: customerPackage.id,
      serviceId: "svc-breast",
      sessions: 1,
    });
    const serviceLine = withRedeem.items.find((i) => i.type === "SERVICE")!;
    const productLine = withRedeem.items.find((i) => i.type === "PRODUCT")!;
    expect(serviceLine.lineTotal).toBe(0);
    expect(productLine.lineTotal).toBe(800);
    expect(withRedeem.total).toBe(800);

    payCash(ORG_ENJOYE_ID, draft.id, 800);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx.total).toBe(800);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(9);
    expect(
      listPackageLedger(ORG_ENJOYE_ID).some(
        (e) => e.type === "REDEMPTION" && e.transactionId === tx.id,
      ),
    ).toBe(true);
  });

  it("product paid with stored value + cash; top-up protection unchanged", () => {
    const product = makeProduct(ORG_ENJOYE_ID, { priceMinor: 1500, sku: "SV-1" });
    getOrCreateStoredValueAccount(ORG_ENJOYE_ID, "demo-001", "staff-001");
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 10000,
      transactionId: "txn-seed-sv-top",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed-sv-top:STORED_VALUE_TOP_UP:i",
    });

    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: product.id,
      name: "",
      unitPrice: 0,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "STORED_VALUE", amount: 1000 },
      { method: "CASH", amount: 500 },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx.total).toBe(1500);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(9000);

    const topUpDraft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, topUpDraft.id, {
      type: "STORED_VALUE_TOP_UP",
      name: "",
      unitPrice: 2000,
    });
    expect(() =>
      setCheckoutPayments(ORG_ENJOYE_ID, topUpDraft.id, [
        { method: "STORED_VALUE", amount: 2000 },
      ]),
    ).toThrow();
  });

  it("retail checkout requires customer + valid location; records sale location", () => {
    expect(() =>
      createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
        locationId: LOC_LUMIERE_PRIMARY_ID,
        customerId: "demo-001",
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/Location/);

    const product = makeProduct(ORG_ENJOYE_ID, { sku: "LOC-A" });
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_SECONDARY_ID,
      quantity: 20,
      createdByStaffId: "staff-001",
    });
    const dA = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, dA.id, {
      type: "PRODUCT",
      referenceId: product.id,
      name: "",
      unitPrice: 0,
    });
    payCash(ORG_ENJOYE_ID, dA.id, 800);
    const txA = completeCheckout(ORG_ENJOYE_ID, dA.id);
    expect(txA.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    expect(txA.appointmentId).toBeUndefined();
    expect(txA.treatmentId).toBeUndefined();

    const dB = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_SECONDARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, dB.id, {
      type: "PRODUCT",
      referenceId: product.id,
      name: "",
      unitPrice: 0,
    });
    payCash(ORG_ENJOYE_ID, dB.id, 800);
    const txB = completeCheckout(ORG_ENJOYE_ID, dB.id);
    expect(txB.locationId).toBe(LOC_ENJOYE_SECONDARY_ID);
  });

  it("void product transaction preserves snapshot; SV reversal still works", () => {
    const product = makeProduct(ORG_ENJOYE_ID, { priceMinor: 1500, sku: "VOID-P" });
    getOrCreateStoredValueAccount(ORG_ENJOYE_ID, "demo-001", "staff-001");
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 5000,
      transactionId: "txn-seed-sv-voidp",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed-sv-voidp:STORED_VALUE_TOP_UP:i",
    });
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: product.id,
      name: "",
      unitPrice: 0,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "STORED_VALUE", amount: 1500 },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(3500);

    updateProduct(ORG_ENJOYE_ID, product.id, { name: "改名後" }, "staff-001");
    const voided = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "結錯帳",
    });
    expect(voided.transaction.status).toBe("VOIDED");
    expect(voided.transaction.items[0].nameSnapshot).toBe("居家按摩霜");
    expect(voided.transaction.total).toBe(1500);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(5000);
    expect(
      listStoredValueLedger(ORG_ENJOYE_ID).some(
        (e) => e.type === "REVERSAL" && e.transactionId === tx.id,
      ),
    ).toBe(true);
  });

  it("quantity update uses centralized calculation", () => {
    const product = makeProduct(ORG_ENJOYE_ID, { sku: "QTY-1", priceMinor: 500 });
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const withItem = addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PRODUCT",
      referenceId: product.id,
      name: "",
      unitPrice: 0,
      quantity: 1,
    });
    const updated = updateCheckoutItemQuantity(
      ORG_ENJOYE_ID,
      draft.id,
      withItem.items[0].id,
      3,
    );
    expect(updated.items[0].quantity).toBe(3);
    expect(updated.items[0].lineTotal).toBe(1500);
    expect(updated.total).toBe(1500);
  });
});
