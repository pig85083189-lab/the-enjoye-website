import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addCheckoutItem,
  completeCheckout,
  createEmptyCheckoutDraft,
  setCheckoutPayments,
} from "@/lib/commerce/checkout-store";
import { applyCommerceLedgerEffects } from "@/lib/commerce/settle-effects";
import { getTransaction } from "@/lib/commerce/transaction-store";
import { voidTransaction } from "@/lib/commerce/void-transaction";
import {
  adjustInventory,
  getProductStock,
  listInventoryMovements,
  listSaleMovementsForTransaction,
  receiveStock,
} from "@/lib/inventory/store";
import {
  createPackageDefinition,
} from "@/lib/packages/store";
import type { Product } from "@/lib/products/domain";
import {
  createProduct,
  getProductById,
  listProducts,
} from "@/lib/products/store";
import {
  PRODUCT_MOVEMENT_TYPE_LABEL,
  PRODUCTS_HAS_PERSISTED_STOCK,
  PRODUCTS_HAS_SECOND_INVENTORY_STORE,
  PRODUCTS_HAS_STOCK_CALCULATOR,
  PRODUCTS_LOW_STOCK_THRESHOLD,
  PRODUCTS_PANEL_WIDTH_PX,
  PRODUCTS_WORKSPACE_GAP_PX,
  buildProductWorkspaceRows,
  countProductSummary,
  deriveProductStockKind,
  filterProductRows,
  inventoryAdjustmentDelta,
  isProductRowKeyboardActivation,
  isValidActualCount,
  mapProductMovementViews,
  matchesProductSearch,
  productHasPersistedStockField,
  productListPresentation,
  shouldResetProductSelection,
  sumLocationProductStock,
} from "@/lib/products/products-workspace-derived";
import { getInventoryMovementsKey } from "@/lib/tenant/storage-keys";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";

beforeEach(() => {
  localStorage.clear();
});

/** Collapse ledger timestamps without changing prepend/append array order. */
function forceSameCreatedAt(organizationId: string, createdAt: string) {
  const key = getInventoryMovementsKey(organizationId);
  const raw = localStorage.getItem(key);
  if (!raw) return;
  const rows = JSON.parse(raw) as Array<{ createdAt: string }>;
  localStorage.setItem(
    key,
    JSON.stringify(rows.map((row) => ({ ...row, createdAt }))),
  );
}

const LOCATIONS = [
  { id: LOC_ENJOYE_PRIMARY_ID, name: "主店" },
  { id: LOC_ENJOYE_SECONDARY_ID, name: "公益店" },
];

function makeProduct(name = "居家按摩霜", sku = "SKU-CREAM-01"): Product {
  return createProduct(ORG_ENJOYE_ID, {
    name,
    sku,
    barcode: "4710001111111",
    category: "居家保養",
    priceMinor: 800,
    createdByStaffId: "staff-001",
  });
}

function payAndSettle(draftId: string, total: number) {
  setCheckoutPayments(ORG_ENJOYE_ID, draftId, [{ method: "CASH", amount: total }]);
  return completeCheckout(ORG_ENJOYE_ID, draftId);
}

describe("product workspace presentation", () => {
  it("uses 400px panel and 16px gap; no persisted stock flags", () => {
    expect(PRODUCTS_PANEL_WIDTH_PX).toBe(400);
    expect(PRODUCTS_WORKSPACE_GAP_PX).toBe(16);
    expect(PRODUCTS_HAS_PERSISTED_STOCK).toBe(false);
    expect(PRODUCTS_HAS_SECOND_INVENTORY_STORE).toBe(false);
    expect(PRODUCTS_HAS_STOCK_CALCULATOR).toBe(false);
    expect(PRODUCTS_LOW_STOCK_THRESHOLD).toBe(5);
    expect(productListPresentation(1536)).toBe("desktop-rows");
    expect(productListPresentation(1024)).toBe("mobile-cards");
    expect(isProductRowKeyboardActivation("Enter")).toBe(true);
    expect(isProductRowKeyboardActivation("Tab")).toBe(false);
    expect(PRODUCT_MOVEMENT_TYPE_LABEL.RECEIVE).toBe("入庫");
    expect(PRODUCT_MOVEMENT_TYPE_LABEL.SALE).toBe("銷售扣庫");
    expect(PRODUCT_MOVEMENT_TYPE_LABEL.ADJUSTMENT).toBe("盤點調整");
    expect(PRODUCT_MOVEMENT_TYPE_LABEL.REVERSAL).toBe("交易作廢回補");
  });

  it("derives stock from movements only and never writes product.stock", () => {
    const product = makeProduct();
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 8,
      createdByStaffId: "staff-001",
    });
    const rows = buildProductWorkspaceRows({
      products: listProducts(ORG_ENJOYE_ID),
      movements: listInventoryMovements(ORG_ENJOYE_ID),
      locationId: LOC_ENJOYE_PRIMARY_ID,
      locations: LOCATIONS,
    });
    expect(rows[0].currentLocationStock).toBe(
      getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id),
    );
    expect(rows[0].currentLocationStock).toBe(
      sumLocationProductStock(
        listInventoryMovements(ORG_ENJOYE_ID),
        LOC_ENJOYE_PRIMARY_ID,
        product.id,
      ),
    );
    expect(productHasPersistedStockField(product)).toBe(false);
    expect(productHasPersistedStockField(getProductById(ORG_ENJOYE_ID, product.id)!)).toBe(
      false,
    );
    expect(JSON.stringify(product)).not.toMatch(/"stock"|currentStock|inventoryCount/);
  });

  it("filters search / catalog / low / sold-out from derived stock", () => {
    const cream = makeProduct("居家按摩霜", "SKU-A");
    const serum = createProduct(ORG_ENJOYE_ID, {
      name: "臉部精華",
      sku: "FACE-01",
      category: "臉部保養",
      priceMinor: 1200,
      createdByStaffId: "staff-001",
    });
    const inactive = createProduct(ORG_ENJOYE_ID, {
      name: "停用乳霜",
      sku: "OFF-01",
      priceMinor: 300,
      isActive: false,
      createdByStaffId: "staff-001",
    });
    receiveStock(ORG_ENJOYE_ID, {
      productId: cream.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 3,
      createdByStaffId: "staff-001",
    });
    const rows = buildProductWorkspaceRows({
      products: listProducts(ORG_ENJOYE_ID),
      movements: listInventoryMovements(ORG_ENJOYE_ID),
      locationId: LOC_ENJOYE_PRIMARY_ID,
      locations: LOCATIONS,
    });
    expect(deriveProductStockKind(3)).toBe("low");
    expect(deriveProductStockKind(0)).toBe("sold_out");
    expect(filterProductRows(rows, { status: "low", query: "" }).map((r) => r.productId)).toEqual([
      cream.id,
    ]);
    expect(filterProductRows(rows, { status: "sold_out", query: "" }).map((r) => r.name)).toContain(
      "臉部精華",
    );
    expect(filterProductRows(rows, { status: "inactive", query: "" })[0]?.productId).toBe(
      inactive.id,
    );
    expect(matchesProductSearch(rows.find((r) => r.productId === serum.id)!, "face-01")).toBe(
      true,
    );
    const summary = countProductSummary(rows);
    expect(summary.catalogCount).toBe(3);
    expect(summary.activeCount).toBe(2);
    expect(summary.currentLocationStockTotal).toBe(3);
    expect(summary.lowStockCount).toBe(1);
    expect(summary.soldOutCount).toBe(1);
  });

  it("computes adjustment as actualCount - getProductStock", () => {
    expect(inventoryAdjustmentDelta(8, 10)).toBe(-2);
    expect(inventoryAdjustmentDelta(12, 10)).toBe(2);
    expect(isValidActualCount(0)).toBe(true);
    expect(isValidActualCount(-1)).toBe(false);
    expect(isValidActualCount(1.5)).toBe(false);
  });

  it("maps movement history with per-location running balance", () => {
    const product = makeProduct();
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 10,
      createdByStaffId: "staff-001",
    });
    adjustInventory(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantityDelta: -2,
      reason: "盤點更正",
      createdByStaffId: "staff-001",
    });
    forceSameCreatedAt(ORG_ENJOYE_ID, "2026-09-30T00:00:00.000Z");
    const views = mapProductMovementViews(listInventoryMovements(ORG_ENJOYE_ID), {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      locations: LOCATIONS,
    });
    const adjust = views.find((row) => row.type === "ADJUSTMENT");
    const receive = views.find((row) => row.type === "RECEIVE");
    expect(adjust?.quantityDelta).toBe(-2);
    expect(receive?.runningBalance).toBe(10);
    expect(adjust?.runningBalance).toBe(8);
    expect(adjust?.typeLabel).toBe("盤點調整");
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(
      8,
    );
  });

  it("same createdAt keeps append order and derived running balances", () => {
    const product = makeProduct("同秒入庫調整", "SKU-TIE-01");
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 10,
      createdByStaffId: "staff-001",
    });
    adjustInventory(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantityDelta: -2,
      reason: "同秒盤點",
      createdByStaffId: "staff-001",
    });
    forceSameCreatedAt(ORG_ENJOYE_ID, "2026-09-30T12:00:00.123Z");

    const views = mapProductMovementViews(listInventoryMovements(ORG_ENJOYE_ID), {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      locations: LOCATIONS,
    });
    const chronological = [...views].reverse();
    expect(chronological.map((row) => row.type)).toEqual(["RECEIVE", "ADJUSTMENT"]);
    expect(chronological.map((row) => row.runningBalance)).toEqual([10, 8]);
    expect(views.find((row) => row.type === "RECEIVE")?.runningBalance).toBe(10);
    expect(views.find((row) => row.type === "ADJUSTMENT")?.runningBalance).toBe(8);
    expect("runningBalance" in (listInventoryMovements(ORG_ENJOYE_ID)[0] ?? {})).toBe(
      false,
    );
  });

  it("three same-timestamp movements stay deterministic across remaps", () => {
    const product = makeProduct("三筆同秒", "SKU-TIE-03");
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 10,
      createdByStaffId: "staff-001",
    });
    adjustInventory(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantityDelta: -2,
      reason: "第二筆",
      createdByStaffId: "staff-001",
    });
    adjustInventory(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantityDelta: -3,
      reason: "第三筆",
      createdByStaffId: "staff-001",
    });
    forceSameCreatedAt(ORG_ENJOYE_ID, "2026-09-30T12:00:00.123Z");

    const expectedTypes = ["RECEIVE", "ADJUSTMENT", "ADJUSTMENT"] as const;
    const expectedBalances = [10, 8, 5];
    let firstIds: string[] | undefined;
    for (let i = 0; i < 20; i += 1) {
      const chronological = [
        ...mapProductMovementViews(listInventoryMovements(ORG_ENJOYE_ID), {
          productId: product.id,
          locationId: LOC_ENJOYE_PRIMARY_ID,
          locations: LOCATIONS,
        }),
      ].reverse();
      expect(chronological.map((row) => row.type)).toEqual([...expectedTypes]);
      expect(chronological.map((row) => row.runningBalance)).toEqual(expectedBalances);
      expect(chronological.map((row) => row.reason ?? "")).toEqual([
        "",
        "第二筆",
        "第三筆",
      ]);
      const ids = chronological.map((row) => row.id);
      if (!firstIds) firstIds = ids;
      expect(ids).toEqual(firstIds);
    }
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(
      5,
    );
  });

  it("resets selection when the row leaves the filtered list", () => {
    const rows = buildProductWorkspaceRows({
      products: [makeProduct()],
      movements: [],
      locationId: LOC_ENJOYE_PRIMARY_ID,
      locations: LOCATIONS,
    });
    expect(
      shouldResetProductSelection({
        selectedProductId: rows[0].productId,
        visibleRows: [],
      }),
    ).toBe(true);
  });
});

describe("inventory ledger A–I", () => {
  it("A RECEIVE +10 increases getProductStock by 10", () => {
    const product = makeProduct();
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(0);
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 10,
      createdByStaffId: "staff-001",
    });
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(10);
  });

  it("B ADJUSTMENT -2 decreases getProductStock by 2", () => {
    const product = makeProduct();
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 10,
      createdByStaffId: "staff-001",
    });
    const current = getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id);
    const delta = inventoryAdjustmentDelta(current - 2, current);
    expect(delta).toBe(-2);
    adjustInventory(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantityDelta: delta,
      reason: "盤點更正",
      createdByStaffId: "staff-001",
    });
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(8);
  });

  it("C PRODUCT sale -1 then D void restores +1", () => {
    const product = makeProduct();
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 5,
      createdByStaffId: "staff-001",
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
      quantity: 1,
    });
    const tx = payAndSettle(draft.id, 800);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(4);
    expect(listSaleMovementsForTransaction(ORG_ENJOYE_ID, tx.id)).toHaveLength(1);
    expect(listSaleMovementsForTransaction(ORG_ENJOYE_ID, tx.id)[0].quantityDelta).toBe(-1);

    voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "isolation void",
    });
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(5);
  });

  it("E retry ledger effects does not double-deduct", () => {
    const product = makeProduct();
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 5,
      createdByStaffId: "staff-001",
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
      quantity: 1,
    });
    const tx = payAndSettle(draft.id, 800);
    applyCommerceLedgerEffects(ORG_ENJOYE_ID, getTransaction(ORG_ENJOYE_ID, tx.id)!, draft);
    applyCommerceLedgerEffects(ORG_ENJOYE_ID, getTransaction(ORG_ENJOYE_ID, tx.id)!, draft);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(4);
    expect(listSaleMovementsForTransaction(ORG_ENJOYE_ID, tx.id)).toHaveLength(1);
  });

  it("F repeat void does not double-restore", () => {
    const product = makeProduct();
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 5,
      createdByStaffId: "staff-001",
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
      quantity: 1,
    });
    const tx = payAndSettle(draft.id, 800);
    voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "first",
    });
    voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "second",
    });
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(5);
    const reversals = listInventoryMovements(ORG_ENJOYE_ID, { transactionId: tx.id }).filter(
      (row) => row.type === "REVERSAL",
    );
    expect(reversals).toHaveLength(1);
  });

  it("G location A movement does not change location B stock", () => {
    const product = makeProduct();
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 10,
      createdByStaffId: "staff-001",
    });
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_SECONDARY_ID, product.id)).toBe(0);
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_SECONDARY_ID,
      quantity: 4,
      createdByStaffId: "staff-001",
    });
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(10);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_SECONDARY_ID, product.id)).toBe(4);
  });

  it("H SERVICE / PACKAGE / STORED_VALUE do not post inventory SALE", () => {
    const product = makeProduct();
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 10,
      createdByStaffId: "staff-001",
    });
    createPackageDefinition(ORG_ENJOYE_ID, {
      name: "美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 10,
      priceMinor: 18000,
      createdByStaffId: "staff-001",
    });
    const serviceDraft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, serviceDraft.id, {
      type: "SERVICE",
      referenceId: "svc-breast",
      name: "性感美胸 SPA",
      unitPrice: 3200,
      quantity: 1,
    });
    const serviceTx = payAndSettle(serviceDraft.id, 3200);
    expect(listSaleMovementsForTransaction(ORG_ENJOYE_ID, serviceTx.id)).toHaveLength(0);

    const pkgDraft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const defs = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "保養 5 堂",
      includedServiceIds: ["svc-facial"],
      sessionCount: 5,
      priceMinor: 8000,
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, pkgDraft.id, {
      type: "PACKAGE_PURCHASE",
      referenceId: defs.id,
      name: defs.name,
      unitPrice: 8000,
      quantity: 1,
    });
    const pkgTx = payAndSettle(pkgDraft.id, 8000);
    expect(listSaleMovementsForTransaction(ORG_ENJOYE_ID, pkgTx.id)).toHaveLength(0);

    const svDraft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, svDraft.id, {
      type: "STORED_VALUE_TOP_UP",
      name: "儲值金",
      unitPrice: 3000,
      quantity: 1,
    });
    const svTx = payAndSettle(svDraft.id, 3000);
    expect(listSaleMovementsForTransaction(ORG_ENJOYE_ID, svTx.id)).toHaveLength(0);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(10);
  });

  it("I product never persists a stock field", () => {
    const product = makeProduct();
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 7,
      createdByStaffId: "staff-001",
    });
    const live = getProductById(ORG_ENJOYE_ID, product.id)!;
    expect("stock" in live).toBe(false);
    expect("currentStock" in live).toBe(false);
    expect("inventoryCount" in live).toBe(false);
    expect(productHasPersistedStockField(live)).toBe(false);
    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(7);
    expect(getProductById(ORG_LUMIERE_ID, product.id)).toBeUndefined();
  });
});

describe("workspace source-file contract", () => {
  it("does not create a second inventory store or persisted stock", () => {
    const derived = readFileSync(
      path.join(process.cwd(), "lib/products/products-workspace-derived.ts"),
      "utf8",
    );
    const page = readFileSync(
      path.join(process.cwd(), "features/products/ProductsPageClient.tsx"),
      "utf8",
    );
    const quickView = readFileSync(
      path.join(process.cwd(), "features/products/ProductQuickView.tsx"),
      "utf8",
    );
    expect(derived).not.toMatch(/product\.stock\b|product\.currentStock|product\.inventoryCount/);
    expect(page).not.toMatch(/product\.stock\b|product\.currentStock|product\.inventoryCount/);
    expect(quickView).not.toMatch(/product\.stock\b|product\.currentStock|product\.inventoryCount/);
    expect(derived).toMatch(/SUM\(quantityDelta\)/);
    expect(page).toMatch(/receiveStock/);
    expect(page).toMatch(/adjustInventory/);
    expect(page).not.toMatch(/completeCheckout|voidTransaction|postInventorySale/);
    expect(quickView).toMatch(/PRODUCTS_PANEL_WIDTH_PX/);
    expect(quickView).not.toMatch(/SUM\(quantityDelta\)|Inventory Ledger/);
    expect(quickView).toMatch(/依庫存異動自動計算/);
    expect(quickView).toMatch(/目前系統庫存/);
    expect(quickView).toMatch(/實際盤點數量/);
    expect(quickView).toMatch(/調整結果/);
    expect(page).toMatch(/data-products-workspace/);
    expect(page).toMatch(/data-products-add-mobile-wrap/);
    const shell = readFileSync(
      path.join(process.cwd(), "components/layout/StaffShell.tsx"),
      "utf8",
    );
    expect(shell).toMatch(/isProductsWorkbench/);
  });
});
