import { describe, expect, it } from "vitest";
import type { CheckoutDraft } from "./domain";
import { validateAtomicPackageRedemptionDraft } from "./package-redemption-guard";

function draft(): CheckoutDraft {
  return {
    id: "checkout-1", organizationId: "org-1", locationId: "loc-1",
    customerId: "cust-1", createdByStaffId: "staff-1",
    items: [{
      id: "item-1", type: "SERVICE", referenceId: "svc-1",
      nameSnapshot: "指定療程", unitPrice: 0, quantity: 1,
      lineSubtotal: 0, discountAmount: 0, lineTotal: 0,
    }],
    packageRedemption: { customerPackageId: "cpkg-1", serviceId: "svc-1", sessions: 1 },
    discounts: [], payments: [], subtotal: 0, discountTotal: 0, total: 0,
    currency: "TWD", status: "READY",
    createdAt: "2026-11-22T00:00:00Z", updatedAt: "2026-11-22T00:00:00Z",
  };
}
describe("atomic package redemption checkout guard", () => {
  it("accepts a single zero-value designated service", () => {
    expect(validateAtomicPackageRedemptionDraft(draft())).toBeNull();
  });
  it("rejects mismatched treatment", () => {
    const d = draft(); d.packageRedemption!.serviceId = "svc-2";
    expect(validateAtomicPackageRedemptionDraft(d)).not.toBeNull();
  });
  it("rejects paid services", () => {
    const d = draft(); d.items[0].unitPrice = 1000;
    expect(validateAtomicPackageRedemptionDraft(d)).not.toBeNull();
  });
  it("rejects a payment even when total is zero", () => {
    const d = draft(); d.payments.push({ id: "pay-1", method: "CASH", amount: 0 });
    expect(validateAtomicPackageRedemptionDraft(d)).not.toBeNull();
  });
  it("rejects mixed items", () => {
    const d = draft(); d.items.push({ ...d.items[0], id: "item-2" });
    expect(validateAtomicPackageRedemptionDraft(d)).not.toBeNull();
  });
  it("rejects a line discount", () => {
    const d = draft(); d.items[0].discountAmount = 1000;
    expect(validateAtomicPackageRedemptionDraft(d)).not.toBeNull();
  });
  it("rejects missing selection", () => {
    const d = draft(); delete d.packageRedemption;
    expect(validateAtomicPackageRedemptionDraft(d)).not.toBeNull();
  });
});
