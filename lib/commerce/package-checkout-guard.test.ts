import { describe, expect, it } from "vitest";
import type { CheckoutDraft } from "./domain";
import { validateAtomicPackagePurchaseDraft } from "./package-checkout-guard";

function draft(): CheckoutDraft {
  return {
    id: "checkout-1", organizationId: "org-1", locationId: "loc-1",
    customerId: "cust-1", createdByStaffId: "staff-1",
    items: [{
      id: "item-1", type: "PACKAGE_PURCHASE", referenceId: "pkg-1",
      nameSnapshot: "指定療程套票", unitPrice: 2000, quantity: 1,
      lineSubtotal: 2000, discountAmount: 0, lineTotal: 2000,
      sessionCountSnapshot: 5,
    }],
    discounts: [], payments: [{ id: "pay-1", method: "CASH", amount: 2000 }],
    subtotal: 2000, discountTotal: 0, total: 2000,
    currency: "TWD", status: "READY",
    createdAt: "2026-11-22T00:00:00Z", updatedAt: "2026-11-22T00:00:00Z",
  };
}

describe("atomic package purchase checkout guard", () => {
  it("accepts a single fully paid package", () => {
    expect(validateAtomicPackagePurchaseDraft(draft())).toBeNull();
  });
  it("rejects mixed carts", () => {
    const d = draft(); d.items.push({ ...d.items[0], id: "item-2" });
    expect(validateAtomicPackagePurchaseDraft(d)).not.toBeNull();
  });
  it("rejects a partial payment", () => {
    const d = draft(); d.payments[0].amount = 1000;
    expect(validateAtomicPackagePurchaseDraft(d)).not.toBeNull();
  });
  it("rejects package discounts and mismatched totals", () => {
    const d = draft(); d.items[0].lineTotal = 1800;
    expect(validateAtomicPackagePurchaseDraft(d)).not.toBeNull();
  });
  it("rejects missing definition IDs", () => {
    const d = draft(); delete d.items[0].referenceId;
    expect(validateAtomicPackagePurchaseDraft(d)).not.toBeNull();
  });
  it("rejects a simultaneous redemption", () => {
    const d = draft(); d.packageRedemption = {
      customerPackageId: "cpkg-1", serviceId: "svc-1", sessions: 1,
    };
    expect(validateAtomicPackagePurchaseDraft(d)).not.toBeNull();
  });
});
