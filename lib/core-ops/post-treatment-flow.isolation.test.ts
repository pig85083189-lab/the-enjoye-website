/**
 * Core Operations Phase 1 — post-treatment package → checkout isolation.
 * Redeem only through completeCheckout. No second store.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  ORG_ENJOYE_ID,
} from "@/lib/tenant/constants";
import {
  createAppointment,
  transitionAppointmentStatus,
} from "@/lib/appointments/store";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  getCheckoutDraft,
  setCheckoutPayments,
  setPackageRedemption,
} from "@/lib/commerce/checkout-store";
import { hasCompletedTransactionForAppointment } from "@/lib/commerce/transaction-store";
import { voidTransaction } from "@/lib/commerce/void-transaction";
import {
  applyPostTreatmentCheckoutIntent,
  loadEligiblePackagesForTreatment,
} from "@/lib/core-ops/post-treatment-checkout";
import {
  POST_TREATMENT_REDEMPTION_SESSIONS,
  buildNextAppointmentHref,
  buildPackageRedemptionSummary,
  remainingAfterRedemption,
} from "@/lib/core-ops/post-treatment-derived";
import {
  createCustomerPackageFromPurchase,
  createPackageDefinition,
  getPackageLedgerBalance,
  listPackageLedger,
  listUsablePackagesForService,
} from "@/lib/packages/store";
import { createProduct } from "@/lib/products/store";
import { receiveStock } from "@/lib/inventory/store";
import { createEmptyDraft, saveCompletedTreatment } from "@/lib/treatment-draft";
import { getCustomerById } from "@/data/mock-customers";

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

function makeInServiceAppointment(serviceId = "svc-breast") {
  const apt = createAppointment(ORG_ENJOYE_ID, {
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "demo-001",
    serviceId,
    staffId: "staff-001",
    startAt: new Date(2026, 8, 29, 14, 0).toISOString(),
    endAt: new Date(2026, 8, 29, 15, 30).toISOString(),
    allowConflict: true,
  });
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "CONFIRMED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "ARRIVED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "IN_SERVICE");
  return apt;
}

function seedCustomerPackage(input: {
  name: string;
  includedServiceIds: string[];
  sessionCount: number;
  purchaseKey: string;
  validityDays?: number;
}) {
  const def = createPackageDefinition(ORG_ENJOYE_ID, {
    name: input.name,
    includedServiceIds: input.includedServiceIds,
    sessionCount: input.sessionCount,
    priceMinor: 18000,
    validityDays: input.validityDays ?? 365,
    createdByStaffId: "staff-001",
  });
  return createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
    customerId: "demo-001",
    packageDefinitionId: def.id,
    purchaseTransactionId: input.purchaseKey,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    createdByStaffId: "staff-001",
    effectKey: `${input.purchaseKey}:PACKAGE_PURCHASE:i`,
  });
}

function src(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("A-D eligibility by canonical serviceId", () => {
  it("A includes package whose snapshot contains the booked serviceId", () => {
    seedCustomerPackage({
      name: "女神美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 10,
      purchaseKey: "txn-el-a",
    });
    const result = loadEligiblePackagesForTreatment({
      organizationId: ORG_ENJOYE_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.includedServiceIdsSnapshot).toContain("svc-breast");
    expect(result.packages[0]?.usableBalance).toBe(10);
  });

  it("B excludes a package for a different canonical serviceId", () => {
    seedCustomerPackage({
      name: "臉部 8 堂",
      includedServiceIds: ["svc-facial"],
      sessionCount: 8,
      purchaseKey: "txn-el-b",
    });
    const result = loadEligiblePackagesForTreatment({
      organizationId: ORG_ENJOYE_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.packages).toHaveLength(0);
    expect(
      listUsablePackagesForService(ORG_ENJOYE_ID, "demo-001", "svc-facial"),
    ).toHaveLength(1);
  });

  it("C excludes expired packages", () => {
    seedCustomerPackage({
      name: "過期美胸",
      includedServiceIds: ["svc-breast"],
      sessionCount: 6,
      purchaseKey: "txn-el-c",
      validityDays: -1,
    });
    const result = loadEligiblePackagesForTreatment({
      organizationId: ORG_ENJOYE_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.packages).toHaveLength(0);
  });

  it("D excludes zero-balance packages", () => {
    const { customerPackage } = seedCustomerPackage({
      name: "一堂即盡",
      includedServiceIds: ["svc-breast"],
      sessionCount: 1,
      purchaseKey: "txn-el-d",
    });
    const apt = makeInServiceAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setPackageRedemption(ORG_ENJOYE_ID, draft.id, {
      customerPackageId: customerPackage.id,
      serviceId: "svc-breast",
      sessions: 1,
    });
    completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(0);
    const result = loadEligiblePackagesForTreatment({
      organizationId: ORG_ENJOYE_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.packages).toHaveLength(0);
  });
});

describe("E-I selection vs settle", () => {
  it("E selected package does not redeem immediately (A/B selector + setPackageRedemption)", () => {
    const { customerPackage } = seedCustomerPackage({
      name: "女神美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 6,
      purchaseKey: "txn-sel-e",
    });
    const apt = makeInServiceAppointment();
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(6);

    const prepared = applyPostTreatmentCheckoutIntent({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
      customerPackageId: customerPackage.id,
    });
    expect(prepared.draft.packageRedemption?.customerPackageId).toBe(
      customerPackage.id,
    );
    expect(prepared.draft.packageRedemption?.sessions).toBe(
      POST_TREATMENT_REDEMPTION_SESSIONS,
    );
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(6);
    expect(
      listPackageLedger(ORG_ENJOYE_ID, { customerPackageId: customerPackage.id }).some(
        (e) => e.type === "REDEMPTION",
      ),
    ).toBe(false);

    const again = setPackageRedemption(ORG_ENJOYE_ID, prepared.draft.id, {
      customerPackageId: customerPackage.id,
      serviceId: "svc-breast",
      sessions: 1,
    });
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(6);
    expect(again.status).toBe("OPEN");
  });

  it("F completeCheckout redeems exactly 1; H NT$0 package-only checkout", () => {
    const { customerPackage } = seedCustomerPackage({
      name: "女神美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 6,
      purchaseKey: "txn-sel-f",
    });
    const apt = makeInServiceAppointment();
    const prepared = applyPostTreatmentCheckoutIntent({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
      customerPackageId: customerPackage.id,
    });
    expect(prepared.draft.total).toBe(0);
    const serviceLine = prepared.draft.items.find((i) => i.type === "SERVICE");
    expect(serviceLine).toBeTruthy();
    expect(serviceLine?.discountAmount).toBe(serviceLine?.lineSubtotal);
    expect(serviceLine?.lineTotal).toBe(0);

    const tx = completeCheckout(ORG_ENJOYE_ID, prepared.draft.id);
    expect(tx.total).toBe(0);
    expect(tx.items.some((i) => i.type === "SERVICE")).toBe(true);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(5);
    const redemptions = listPackageLedger(ORG_ENJOYE_ID, {
      customerPackageId: customerPackage.id,
    }).filter((e) => e.type === "REDEMPTION");
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]?.sessionDelta).toBe(-1);
    expect(redemptions[0]?.transactionId).toBe(tx.id);
    expect(redemptions[0]?.effectKey).toBe(
      `${tx.id}:PACKAGE_REDEMPTION:${customerPackage.id}`,
    );
  });

  it("G retry completeCheckout does not double redeem; E same appointment second completed checkout blocked", () => {
    const { customerPackage } = seedCustomerPackage({
      name: "女神美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 6,
      purchaseKey: "txn-sel-g",
    });
    const apt = makeInServiceAppointment();
    const prepared = applyPostTreatmentCheckoutIntent({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
      customerPackageId: customerPackage.id,
    });
    const tx = completeCheckout(ORG_ENJOYE_ID, prepared.draft.id);
    const again = completeCheckout(ORG_ENJOYE_ID, prepared.draft.id);
    expect(again.id).toBe(tx.id);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(5);
    expect(
      listPackageLedger(ORG_ENJOYE_ID, { customerPackageId: customerPackage.id }).filter(
        (e) => e.type === "REDEMPTION",
      ),
    ).toHaveLength(1);
    expect(hasCompletedTransactionForAppointment(ORG_ENJOYE_ID, apt.id)).toBe(true);
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/already has a completed transaction/i);
  });

  it("I package + product stay one checkout / one transaction", () => {
    const { customerPackage } = seedCustomerPackage({
      name: "女神美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 6,
      purchaseKey: "txn-sel-i",
    });
    const product = createProduct(ORG_ENJOYE_ID, {
      name: "膠原蛋白",
      sku: "COL-2200",
      priceMinor: 2200,
      createdByStaffId: "staff-001",
    });
    receiveStock(ORG_ENJOYE_ID, {
      productId: product.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      quantity: 10,
      createdByStaffId: "staff-001",
    });
    const apt = makeInServiceAppointment();
    const prepared = applyPostTreatmentCheckoutIntent({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
      customerPackageId: customerPackage.id,
    });
    addCheckoutItem(ORG_ENJOYE_ID, prepared.draft.id, {
      type: "PRODUCT",
      referenceId: product.id,
      name: "",
      unitPrice: 0,
      quantity: 1,
    });
    const live = getCheckoutDraft(ORG_ENJOYE_ID, prepared.draft.id)!;
    expect(live.total).toBe(2200);
    expect(live.items.some((i) => i.type === "SERVICE")).toBe(true);
    expect(live.items.some((i) => i.type === "PRODUCT")).toBe(true);
    setCheckoutPayments(ORG_ENJOYE_ID, live.id, [
      { method: "CASH", amount: 2200 },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, live.id);
    expect(tx.total).toBe(2200);
    expect(tx.items.filter((i) => i.type === "SERVICE")).toHaveLength(1);
    expect(tx.items.filter((i) => i.type === "PRODUCT")).toHaveLength(1);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(5);
  });
});

describe("J void restores sessions", () => {
  it("6 → settle 5 → void 6 with REDEMPTION -1 and REVERSAL +1", () => {
    const { customerPackage } = seedCustomerPackage({
      name: "女神美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 6,
      purchaseKey: "txn-void-j",
    });
    const apt = makeInServiceAppointment();
    const prepared = applyPostTreatmentCheckoutIntent({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
      customerPackageId: customerPackage.id,
    });
    const tx = completeCheckout(ORG_ENJOYE_ID, prepared.draft.id);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(5);
    const result = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "結帳重做",
    });
    expect(result.packageReversals).toHaveLength(1);
    expect(result.packageReversals[0]?.sessionDelta).toBe(1);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(6);
    const ledger = listPackageLedger(ORG_ENJOYE_ID, {
      customerPackageId: customerPackage.id,
    });
    const redemption = ledger.find((e) => e.type === "REDEMPTION")!;
    const reversal = ledger.find((e) => e.type === "REVERSAL")!;
    expect(redemption.sessionDelta).toBe(-1);
    expect(reversal.sessionDelta).toBe(1);
    expect(reversal.reversesEntryId).toBe(redemption.id);
  });
});

describe("K SERVICE line remains; P treatment complete does not redeem", () => {
  it("K transaction keeps SERVICE line after package settle", () => {
    const { customerPackage } = seedCustomerPackage({
      name: "女神美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 6,
      purchaseKey: "txn-svc-k",
    });
    const apt = makeInServiceAppointment();
    const prepared = applyPostTreatmentCheckoutIntent({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
      customerPackageId: customerPackage.id,
    });
    const tx = completeCheckout(ORG_ENJOYE_ID, prepared.draft.id);
    expect(tx.items.some((i) => i.type === "SERVICE")).toBe(true);
    expect(tx.items.map((i) => i.type)).not.toContain("REDEEMED");
    expect(tx.packageRedemption?.customerPackageId).toBe(customerPackage.id);
  });

  it("P saveCompletedTreatment does not write package ledger", () => {
    const { customerPackage } = seedCustomerPackage({
      name: "女神美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 6,
      purchaseKey: "txn-tx-p",
    });
    const apt = makeInServiceAppointment();
    const draft = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      appointmentId: apt.id,
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    saveCompletedTreatment(draft);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(6);
    expect(
      listPackageLedger(ORG_ENJOYE_ID, { customerPackageId: customerPackage.id }).some(
        (e) => e.type === "REDEMPTION",
      ),
    ).toBe(false);
  });
});

describe("derived remaining + hrefs", () => {
  it("remaining after use is derived, never a persisted field", () => {
    expect(remainingAfterRedemption(6)).toBe(5);
    expect(POST_TREATMENT_REDEMPTION_SESSIONS).toBe(1);
    const href = buildNextAppointmentHref({
      customerId: "demo-001",
      serviceId: "svc-breast",
      staffId: "staff-001",
    });
    expect(href).toContain("customer=demo-001");
    expect(href).toContain("service=svc-breast");
    expect(href).toContain("staff=staff-001");
    expect(href).not.toContain("customerName");
  });

  it("redemption summary uses draft SERVICE line, not a REDEEMED type", () => {
    const { customerPackage } = seedCustomerPackage({
      name: "女神美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 6,
      purchaseKey: "txn-sum",
    });
    const apt = makeInServiceAppointment();
    const prepared = applyPostTreatmentCheckoutIntent({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
      customerPackageId: customerPackage.id,
    });
    const summary = buildPackageRedemptionSummary({
      draft: prepared.draft,
      serviceName: "性感美胸 SPA",
      packageName: "女神美胸 10 堂",
      currentRemaining: 6,
    });
    expect(summary?.dueMinor).toBe(0);
    expect(summary?.sessionsUsed).toBe(1);
    expect(summary?.remainingAfterSettle).toBe(5);
    expect(summary?.packageDiscountMinor).toBe(summary?.originalPriceMinor);
  });
});

describe("L-O architecture guards", () => {
  it("L never persists remainingSessions; CRM residue is not SoT", () => {
    const { customerPackage } = seedCustomerPackage({
      name: "女神美胸 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 6,
      purchaseKey: "txn-l",
    });
    expect("remainingSessions" in customerPackage).toBe(false);
    const residue = getCustomerById("demo-001", ORG_ENJOYE_ID)?.packages?.[0]?.remainingSessions;
    const usable = listUsablePackagesForService(
      ORG_ENJOYE_ID,
      "demo-001",
      "svc-breast",
    )[0];
    expect(usable?.usableBalance).toBe(6);
    if (typeof residue === "number") {
      expect(usable?.usableBalance).not.toBe(residue);
    }
  });

  it("M-O no name join, no second redemption/checkout/visit store, CompleteStep does not redeem", () => {
    const derived = src("lib/core-ops/post-treatment-derived.ts");
    const orch = src("lib/core-ops/post-treatment-checkout.ts");
    const complete = src("features/treatments/steps/CompleteStep.tsx");
    const panel = src("features/checkout/CheckoutPanel.tsx");
    const page = src("features/checkout/CheckoutPageClient.tsx");

    expect(orch).toMatch(/listUsablePackagesForService/);
    expect(orch).toMatch(/setPackageRedemption/);
    expect(orch).toMatch(/createCheckoutFromAppointment/);
    expect(orch).not.toMatch(/redeemPackageSession/);
    expect(orch).not.toMatch(/completeCheckout/);
    expect(complete).not.toMatch(/redeemPackageSession/);
    expect(complete).toMatch(/applyPostTreatmentCheckoutIntent/);
    expect(complete).toMatch(/loadEligiblePackagesForTreatment/);
    expect(complete).toMatch(/aria-selected/);
    expect(complete).toMatch(/使用此套票/);
    expect(complete).toMatch(/已選擇/);
    expect(complete).toMatch(/bg-\[#FBF4F3\]/);
    expect(complete).toMatch(/border-l-\[#C56B70\]/);
    expect(panel).toMatch(/completeCheckout/);
    expect(panel).toMatch(/applyPostTreatmentCheckoutIntent/);
    expect(panel).toMatch(/data-package-redemption-summary/);
    expect(panel).not.toMatch(/PaymentMethod\.PACKAGE/);
    expect(page).toMatch(/preselectedPackageId/);
    expect(page).toMatch(/searchParams.get\("package"\)/);

    expect(derived).not.toMatch(/localStorage/);
    expect(derived).not.toMatch(/remainingSessions/);
    expect(orch).not.toMatch(/customer\.packages/);
    expect(complete).not.toMatch(/customer\.packages/);
    expect(`${derived}\n${orch}`).not.toMatch(/VisitStore|SessionStore|RedemptionStore/);
    expect(orch).not.toMatch(/includedServiceIdsSnapshot\.includes\(.*name/);
    expect(orch).toMatch(/apt\.serviceId/);
  });
});
