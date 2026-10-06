import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addCheckoutItem,
  completeCheckout,
  createEmptyCheckoutDraft,
  setCheckoutPayments,
} from "@/lib/commerce/checkout-store";
import type { PackageDefinition } from "@/lib/packages/domain";
import {
  addPlanService,
  availablePlanServices,
  activeDefinitionsForSale,
  buildPackagePlanRows,
  canManagePackagePlans,
  countPackagePlanSummary,
  draftFromPackageDefinition,
  emptyPackagePlanDraft,
  filterPackagePlanRows,
  isCombinationPlan,
  isInlinePackagePlanQuickViewViewport,
  isPackagePlanRowKeyboardActivation,
  matchesPackagePlanSearch,
  PACKAGE_PLANS_HAS_LOCATION_RESTRICTION,
  PACKAGE_PLANS_HAS_PERSISTED_KPI,
  PACKAGE_PLANS_HAS_PER_SERVICE_QUOTA,
  PACKAGE_PLANS_HAS_SECOND_STORE,
  PACKAGE_PLANS_INLINE_MIN_PX,
  PACKAGE_PLANS_PANEL_WIDTH_PX,
  PACKAGE_PLANS_USES_SHARED_SESSION_POOL,
  PACKAGE_PLANS_WORKSPACE_GAP_PX,
  PACKAGE_PLAN_HREF,
  packagePlanEmptyCopy,
  parsePackagePlanDraft,
  parsePlanPrice,
  parsePlanSessionCount,
  planContentsLabel,
  planValidityLabel,
  removePlanService,
  shouldResetPackagePlanSelection,
  validatePackagePlanStep,
} from "@/lib/packages/package-plans-derived";
import { filterDefinitionsForPackagePicker } from "@/lib/packages/packages-workspace-derived";
import {
  createCustomerPackageFromPurchase,
  createPackageDefinition,
  deactivatePackageDefinition,
  getPackageDefinition,
  getPackageUsableBalance,
  listCustomerPackages,
  listPackageDefinitions,
  listPackageLedger,
  redeemPackageSession,
  updatePackageDefinition,
} from "@/lib/packages/store";
import {
  LOC_ENJOYE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";

const NOW = new Date("2026-09-29T06:00:00.000Z");

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

function seedDefinition(
  over: Partial<Parameters<typeof createPackageDefinition>[1]> = {},
) {
  return createPackageDefinition(ORG_ENJOYE_ID, {
    name: "性感美胸 SPA 10 堂",
    includedServiceIds: ["svc-breast"],
    sessionCount: 10,
    priceMinor: 22000,
    validityDays: 180,
    createdByStaffId: "staff-001",
    ...over,
  });
}

describe("package plan domain reuse", () => {
  it("A. creates a plan through canonical PackageDefinition mutations", () => {
    const parsed = parsePackagePlanDraft({
      ...emptyPackagePlanDraft(),
      name: "性感美胸 SPA 10 堂",
      priceInput: "22000",
      validityMode: "180",
      includedServiceIds: ["svc-breast"],
      sessionCountInput: "10",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const def = createPackageDefinition(ORG_ENJOYE_ID, {
      name: parsed.value.name,
      description: parsed.value.description,
      includedServiceIds: parsed.value.includedServiceIds,
      sessionCount: parsed.value.sessionCount,
      priceMinor: parsed.value.priceMinor,
      validityDays: parsed.value.validityDays ?? undefined,
      createdByStaffId: "staff-001",
    });
    expect(def.id.startsWith("pkgdef-")).toBe(true);
    expect(listPackageDefinitions(ORG_ENJOYE_ID).some((row) => row.id === def.id)).toBe(
      true,
    );
    expect(existsSync(path.join(process.cwd(), "lib/packages/package-plans-store.ts"))).toBe(
      false,
    );
  });

  it("B. blank name cannot be created", () => {
    expect(validatePackagePlanStep(1, emptyPackagePlanDraft())).toMatch(/套票名稱/);
    expect(() =>
      createPackageDefinition(ORG_ENJOYE_ID, {
        name: "   ",
        includedServiceIds: ["svc-breast"],
        sessionCount: 10,
        priceMinor: 1000,
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/name/i);
  });

  it("C. validates sale price", () => {
    expect(parsePlanPrice("").ok).toBe(false);
    expect(parsePlanPrice("-1").ok).toBe(false);
    expect(parsePlanPrice("12.5").ok).toBe(false);
    expect(parsePlanPrice("22000")).toEqual({ ok: true, value: 22000 });
    expect(
      validatePackagePlanStep(1, {
        ...emptyPackagePlanDraft(),
        name: "方案",
        priceInput: "",
      }),
    ).toMatch(/售價/);
  });

  it("D/E. requires at least one service and sessions >= 1", () => {
    const draft = {
      ...emptyPackagePlanDraft(),
      name: "方案",
      priceInput: "1000",
    };
    expect(validatePackagePlanStep(2, draft)).toMatch(/療程/);
    expect(
      validatePackagePlanStep(2, { ...draft, includedServiceIds: ["svc-breast"] }),
    ).toMatch(/堂數/);
    expect(parsePlanSessionCount("0").ok).toBe(false);
    expect(parsePlanSessionCount("1")).toEqual({ ok: true, value: 1 });
    expect(() =>
      createPackageDefinition(ORG_ENJOYE_ID, {
        name: "空",
        includedServiceIds: [],
        sessionCount: 10,
        priceMinor: 1000,
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/at least one service/i);
    expect(() =>
      createPackageDefinition(ORG_ENJOYE_ID, {
        name: "零堂",
        includedServiceIds: ["svc-breast"],
        sessionCount: 0,
        priceMinor: 1000,
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/sessionCount/);
  });
});

describe("package plan isolation and sale", () => {
  it("F. organization isolation", () => {
    const def = seedDefinition();
    expect(getPackageDefinition(ORG_LUMIERE_ID, def.id)).toBeUndefined();
    const rows = buildPackagePlanRows({
      organizationId: ORG_LUMIERE_ID,
      definitions: [def],
      packages: [],
      ledger: [],
      now: NOW,
    });
    expect(rows).toEqual([]);
    expect(() =>
      updatePackageDefinition(ORG_LUMIERE_ID, def.id, { name: "hack" }, "staff-lumiere-01"),
    ).toThrow(/not found/i);
  });

  it("G. location restriction is not faked; sale still records location on checkout", () => {
    expect(PACKAGE_PLANS_HAS_LOCATION_RESTRICTION).toBe(false);
    const def = seedDefinition();
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const withItem = addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PACKAGE_PURCHASE",
      referenceId: def.id,
      name: def.name,
      unitPrice: def.priceMinor,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, withItem.id, [
      { method: "CASH", amount: withItem.total },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, withItem.id);
    const purchase = listPackageLedger(ORG_ENJOYE_ID).find(
      (entry) => entry.type === "PURCHASE" && entry.transactionId === tx.id,
    );
    expect(purchase?.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    expect("locationIds" in def).toBe(false);
  });

  it("H/I. active plans appear in sale selector; inactive plans do not", () => {
    const active = seedDefinition({ name: "販售中方案" });
    const inactive = seedDefinition({ name: "停售方案" });
    deactivatePackageDefinition(ORG_ENJOYE_ID, inactive.id, "staff-001");
    const list = listPackageDefinitions(ORG_ENJOYE_ID);
    expect(activeDefinitionsForSale(list).map((row) => row.id)).toContain(active.id);
    expect(activeDefinitionsForSale(list).map((row) => row.id)).not.toContain(
      inactive.id,
    );
    expect(filterDefinitionsForPackagePicker(list, "").map((row) => row.id)).toEqual(
      expect.arrayContaining([active.id]),
    );
    expect(filterDefinitionsForPackagePicker(list, "").map((row) => row.id)).not.toContain(
      inactive.id,
    );
  });

  it("J. inactive plan keeps existing customer packages", () => {
    const def = seedDefinition();
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-keep",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-keep:PACKAGE_PURCHASE:i",
    });
    deactivatePackageDefinition(ORG_ENJOYE_ID, def.id, "staff-001");
    expect(getPackageDefinition(ORG_ENJOYE_ID, def.id)?.isActive).toBe(false);
    expect(listCustomerPackages(ORG_ENJOYE_ID).some((row) => row.id === customerPackage.id)).toBe(
      true,
    );
    expect(getPackageUsableBalance(ORG_ENJOYE_ID, customerPackage.id).usableBalance).toBe(10);
  });

  it("K/L. sale still goes through canonical checkout and customer package store", () => {
    const def = seedDefinition();
    const checkoutDraft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const withItem = addCheckoutItem(ORG_ENJOYE_ID, checkoutDraft.id, {
      type: "PACKAGE_PURCHASE",
      referenceId: def.id,
      name: def.name,
      unitPrice: def.priceMinor,
    });
    expect(withItem.items[0]?.type).toBe("PACKAGE_PURCHASE");
    expect(withItem.items[0]?.referenceId).toBe(def.id);
    setCheckoutPayments(ORG_ENJOYE_ID, withItem.id, [
      { method: "CASH", amount: withItem.total },
    ]);
    completeCheckout(ORG_ENJOYE_ID, withItem.id);
    const pkgs = listCustomerPackages(ORG_ENJOYE_ID, { customerId: "demo-001" });
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]?.packageDefinitionId).toBe(def.id);
    expect(pkgs[0]?.nameSnapshot).toBe(def.name);
  });

  it("M. deactivation does not block redemption of existing holdings", () => {
    const def = seedDefinition();
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-red",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-red:PACKAGE_PURCHASE:i",
    });
    deactivatePackageDefinition(ORG_ENJOYE_ID, def.id, "staff-001");
    redeemPackageSession(ORG_ENJOYE_ID, {
      customerPackageId: customerPackage.id,
      customerId: "demo-001",
      serviceId: "svc-breast",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      transactionId: "txn-use",
      createdByStaffId: "staff-001",
      effectKey: "txn-use:PACKAGE_REDEMPTION:cp",
    });
    expect(getPackageUsableBalance(ORG_ENJOYE_ID, customerPackage.id).usableBalance).toBe(9);
  });

  it("N. old package data without description/validity still maps", () => {
    const legacy: PackageDefinition = {
      id: "pkgdef-legacy",
      organizationId: ORG_ENJOYE_ID,
      name: "舊方案",
      includedServices: [{ serviceId: "svc-breast", sessionsPerRedemption: 1 }],
      sessionCount: 5,
      priceMinor: 8000,
      currency: "TWD",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const rows = buildPackagePlanRows({
      organizationId: ORG_ENJOYE_ID,
      definitions: [legacy],
      packages: [],
      ledger: [],
      serviceNames: { "svc-breast": "性感美胸 SPA" },
      now: NOW,
    });
    expect(rows[0]?.description).toBe("");
    expect(rows[0]?.validityDays).toBeNull();
    expect(rows[0]?.validityLabel).toBe("無固定期限");
    expect(rows[0]?.contentsLabel).toBe("性感美胸 SPA × 5");
  });
});

describe("package plan derived workspace", () => {
  it("O. summary is derived, not persisted", () => {
    expect(PACKAGE_PLANS_HAS_PERSISTED_KPI).toBe(false);
    const active = seedDefinition({ name: "單項" });
    const combo = seedDefinition({
      name: "女神保養套票",
      includedServiceIds: ["svc-breast", "svc-curve", "svc-womb"],
      sessionCount: 12,
      priceMinor: 25800,
      validityDays: 365,
    });
    deactivatePackageDefinition(ORG_ENJOYE_ID, seedDefinition({ name: "停" }).id, "staff-001");
    const rows = buildPackagePlanRows({
      organizationId: ORG_ENJOYE_ID,
      definitions: listPackageDefinitions(ORG_ENJOYE_ID),
      packages: [],
      ledger: [],
      serviceNames: {
        "svc-breast": "性感美胸 SPA",
        "svc-curve": "窈窕曲線 SPA",
        "svc-womb": "暖宮 SPA",
      },
      now: NOW,
    });
    const summary = countPackagePlanSummary(rows);
    expect(summary.total).toBe(3);
    expect(summary.active).toBe(2);
    expect(summary.inactive).toBe(1);
    expect(summary.combination).toBe(1);
    expect(isCombinationPlan(combo)).toBe(true);
    expect(isCombinationPlan(active)).toBe(false);
    expect(rows.find((row) => row.definitionId === combo.id)?.contentsLabel).toBe(
      "3 項療程 · 共用 12 堂",
    );
  });

  it("P/Q. search and filter", () => {
    const breast = seedDefinition({ name: "性感美胸 SPA 10 堂" });
    const stopped = seedDefinition({ name: "停售暖宮" });
    deactivatePackageDefinition(ORG_ENJOYE_ID, stopped.id, "staff-001");
    const rows = buildPackagePlanRows({
      organizationId: ORG_ENJOYE_ID,
      definitions: listPackageDefinitions(ORG_ENJOYE_ID),
      packages: [],
      ledger: [],
      now: NOW,
    });
    expect(matchesPackagePlanSearch({ name: breast.name }, "美胸")).toBe(true);
    expect(filterPackagePlanRows(rows, "active", "").map((row) => row.definitionId)).toEqual(
      [breast.id],
    );
    expect(filterPackagePlanRows(rows, "inactive", "").map((row) => row.definitionId)).toEqual(
      [stopped.id],
    );
    expect(filterPackagePlanRows(rows, "all", "暖宮").map((row) => row.definitionId)).toEqual(
      [stopped.id],
    );
  });

  it("R/S. update, deactivate, and reactivate", () => {
    const def = seedDefinition();
    const updated = updatePackageDefinition(
      ORG_ENJOYE_ID,
      def.id,
      { name: "性感美胸 SPA 12 堂", sessionCount: 12, priceMinor: 24000 },
      "staff-001",
    );
    expect(updated.name).toBe("性感美胸 SPA 12 堂");
    expect(updated.sessionCount).toBe(12);
    const stopped = deactivatePackageDefinition(ORG_ENJOYE_ID, def.id, "staff-001");
    expect(stopped.isActive).toBe(false);
    const live = updatePackageDefinition(
      ORG_ENJOYE_ID,
      def.id,
      { isActive: true },
      "staff-001",
    );
    expect(live.isActive).toBe(true);
  });

  it("derives sold count and active holders from customer packages + ledger", () => {
    const def = seedDefinition();
    const first = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-s1",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-s1:PACKAGE_PURCHASE:i",
    });
    createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-002",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-s2",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-s2:PACKAGE_PURCHASE:i",
    });
    redeemPackageSession(ORG_ENJOYE_ID, {
      customerPackageId: first.customerPackage.id,
      customerId: "demo-001",
      serviceId: "svc-breast",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      transactionId: "txn-use-s1",
      createdByStaffId: "staff-001",
      effectKey: "txn-use-s1:PACKAGE_REDEMPTION:cp",
    });
    const rows = buildPackagePlanRows({
      organizationId: ORG_ENJOYE_ID,
      definitions: [getPackageDefinition(ORG_ENJOYE_ID, def.id)!],
      packages: listCustomerPackages(ORG_ENJOYE_ID),
      ledger: listPackageLedger(ORG_ENJOYE_ID),
      now: NOW,
    });
    expect(rows[0]?.soldCount).toBe(2);
    expect(rows[0]?.activeHolderCount).toBe(2);
  });

  it("empty copy is not an error state", () => {
    expect(packagePlanEmptyCopy({ hasAny: false, filter: "all", query: "" }).title).toBe(
      "尚未建立套票方案",
    );
    expect(
      packagePlanEmptyCopy({ hasAny: true, filter: "inactive", query: "" }).title,
    ).toBe("目前沒有已停售的套票方案");
  });

  it("layout contract, permissions, and combination honesty", () => {
    expect(PACKAGE_PLANS_PANEL_WIDTH_PX).toBe(400);
    expect(PACKAGE_PLANS_WORKSPACE_GAP_PX).toBe(16);
    expect(PACKAGE_PLANS_INLINE_MIN_PX).toBe(1200);
    expect(isInlinePackagePlanQuickViewViewport(1536)).toBe(true);
    expect(isInlinePackagePlanQuickViewViewport(1024)).toBe(false);
    expect(isPackagePlanRowKeyboardActivation("Enter")).toBe(true);
    expect(canManagePackagePlans("OWNER")).toBe(true);
    expect(canManagePackagePlans("MANAGER")).toBe(true);
    expect(canManagePackagePlans("STAFF")).toBe(false);
    expect(canManagePackagePlans("RECEPTIONIST")).toBe(false);
    expect(PACKAGE_PLANS_HAS_PER_SERVICE_QUOTA).toBe(false);
    expect(PACKAGE_PLANS_USES_SHARED_SESSION_POOL).toBe(true);
    expect(planValidityLabel(180)).toBe("180 天");
    expect(planContentsLabel({ includedServiceNames: ["性感美胸 SPA"], sessionCount: 10 })).toBe(
      "性感美胸 SPA × 10",
    );
    expect(PACKAGE_PLAN_HREF).toBe("/staff/packages/plans");
    expect(
      availablePlanServices(
        [
          { id: "svc-breast", name: "性感美胸 SPA" },
          { id: "svc-womb", name: "暖宮 SPA" },
        ],
        ["svc-breast"],
      ).map((row) => row.id),
    ).toEqual(["svc-womb"]);
    expect(addPlanService(["svc-breast"], "svc-womb")).toEqual(["svc-breast", "svc-womb"]);
    expect(addPlanService(["svc-breast"], "svc-breast")).toEqual(["svc-breast"]);
    expect(removePlanService(["svc-breast", "svc-womb"], "svc-womb")).toEqual(["svc-breast"]);
    expect(
      shouldResetPackagePlanSelection({
        selectedPlanId: "gone",
        visibleRows: [],
      }),
    ).toBe(true);
  });

  it("shared-pool combination still redeems by eligible serviceId", () => {
    const def = seedDefinition({
      name: "女神保養套票",
      includedServiceIds: ["svc-breast", "svc-curve"],
      sessionCount: 12,
    });
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-combo",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-combo:PACKAGE_PURCHASE:i",
    });
    expect(customerPackage.sessionCountSnapshot).toBe(12);
    expect(customerPackage.includedServiceIdsSnapshot).toEqual(["svc-breast", "svc-curve"]);
    redeemPackageSession(ORG_ENJOYE_ID, {
      customerPackageId: customerPackage.id,
      customerId: "demo-001",
      serviceId: "svc-curve",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      transactionId: "txn-combo-use",
      createdByStaffId: "staff-001",
      effectKey: "txn-combo-use:PACKAGE_REDEMPTION:cp",
    });
    expect(getPackageUsableBalance(ORG_ENJOYE_ID, customerPackage.id).usableBalance).toBe(11);
    expect(() =>
      redeemPackageSession(ORG_ENJOYE_ID, {
        customerPackageId: customerPackage.id,
        customerId: "demo-001",
        serviceId: "svc-facial",
        locationId: LOC_ENJOYE_PRIMARY_ID,
        transactionId: "txn-combo-wrong",
        createdByStaffId: "staff-001",
        effectKey: "txn-combo-wrong:PACKAGE_REDEMPTION:cp",
      }),
    ).toThrow(/not eligible/i);
  });

  it("draft round-trip and inactive create path uses existing isActive patch", () => {
    const def = seedDefinition({ description: "說明" });
    const draft = draftFromPackageDefinition(def);
    expect(draft.validityMode).toBe("180");
    expect(draft.includedServiceIds).toEqual(["svc-breast"]);
    const parsed = parsePackagePlanDraft({ ...draft, isActive: false });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const next = updatePackageDefinition(
      ORG_ENJOYE_ID,
      def.id,
      {
        name: parsed.value.name,
        description: parsed.value.description ?? "",
        includedServiceIds: parsed.value.includedServiceIds,
        sessionCount: parsed.value.sessionCount,
        priceMinor: parsed.value.priceMinor,
        validityDays: parsed.value.validityDays ?? null,
        isActive: parsed.value.isActive,
      },
      "staff-001",
    );
    expect(next.isActive).toBe(false);
  });
});

describe("package plan source contract T", () => {
  it("does not invent a second store, checkout, or redemption path", () => {
    expect(PACKAGE_PLANS_HAS_SECOND_STORE).toBe(false);
    const root = process.cwd();
    const derived = readFileSync(path.join(root, "lib/packages/package-plans-derived.ts"), "utf8");
    const page = readFileSync(
      path.join(root, "features/packages/PackagePlansPageClient.tsx"),
      "utf8",
    );
    const editor = readFileSync(
      path.join(root, "features/packages/PackagePlanEditorDialog.tsx"),
      "utf8",
    );
    const quickView = readFileSync(
      path.join(root, "features/packages/PackagePlanQuickView.tsx"),
      "utf8",
    );
    const holdings = readFileSync(
      path.join(root, "features/packages/PackagesPageClient.tsx"),
      "utf8",
    );
    const sell = readFileSync(
      path.join(root, "features/packages/PackageSellModal.tsx"),
      "utf8",
    );
    const domain = readFileSync(path.join(root, "lib/packages/domain.ts"), "utf8");
    const store = readFileSync(path.join(root, "lib/packages/store.ts"), "utf8");

    expect(derived).not.toMatch(/localStorage/);
    expect(derived).not.toMatch(/createCustomerPackageFromPurchase/);
    expect(derived).toMatch(/PackageDefinition/);
    expect(page).toMatch(/listPackageDefinitions/);
    expect(page).toMatch(/usePackageRemoteDefinitions/);
    expect(page).toMatch(/packageRemoteReadPilot/);
    expect(page).toMatch(/createPackageDefinition|PackagePlanEditorDialog/);
    expect(page).not.toMatch(/localStorage\.setItem/);
    expect(page).not.toMatch(/createCustomerPackageFromPurchase/);
    expect(editor).toMatch(/createPackageDefinition/);
    expect(editor).toMatch(/submitPackageRemoteCreate/);
    expect(editor).toMatch(/updatePackageDefinition/);
    expect(editor).not.toMatch(/localStorage\.setItem/);
    expect(editor).not.toMatch(/createCustomerPackageFromPurchase/);
    expect(page).toMatch(/updatePackageDefinition/);
    expect(quickView).toMatch(/onDeactivate/);
    expect(quickView).toMatch(/onReactivate/);
    expect(quickView).not.toMatch(/localStorage\.setItem/);
    expect(holdings).toMatch(/\/staff\/packages\/plans/);
    expect(holdings).toMatch(/販售套票/);
    expect(sell).toMatch(/createEmptyCheckoutDraft/);
    expect(sell).toMatch(/PACKAGE_PURCHASE/);
    expect(sell).not.toMatch(/completeCheckout/);
    expect(domain).toMatch(/export interface PackageDefinition/);
    expect(store).toMatch(/export function createPackageDefinition/);
    expect(store).toMatch(/export function createCustomerPackageFromPurchase/);
    expect(store).toMatch(/export function redeemPackageSession/);
    expect(existsSync(path.join(root, "lib/packages/package-plans-store.ts"))).toBe(false);
    expect(existsSync(path.join(root, "features/packages/package-plans-store.ts"))).toBe(
      false,
    );
  });
});
