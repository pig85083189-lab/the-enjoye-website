import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/commerce/domain";
import {
  filterCommerceTransactionsByCustomerId,
  resolveCustomer360Transactions,
} from "@/lib/customers/customer-360";
import { resolveTreatmentQuickViewCheckoutHref } from "@/lib/treatments/treatment-workspace-derived";
import { createEmptyDraft } from "@/lib/treatment-draft";

const ROOT = process.cwd();
const ORG = "org-the-enjoye";
const CUST = "cust-muvb8x0p-887ltc";
const OTHER = "cust-muvxogn2-cljfds";
const APT = "apt-muw55olz-h64n65";
const TRT = "trt-muw6y969-aqo5o6";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-remote-1",
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    customerId: CUST,
    appointmentId: APT,
    treatmentId: TRT,
    transactionNumber: "TX-20261006-0001",
    status: "COMPLETED",
    items: [
      {
        id: "txi-1",
        type: "SERVICE",
        referenceId: "svc-muw54el4-7omtyn",
        nameSnapshot: "美波澎潤upupSPA",
        unitPrice: 1800,
        quantity: 1,
        lineSubtotal: 1800,
        discountAmount: 0,
        lineTotal: 1800,
      },
    ],
    discounts: [],
    payments: [
      {
        id: "txp-1",
        method: "CASH",
        amount: 1800,
        paidAt: "2026-10-06T05:10:00.000Z",
      },
    ],
    subtotal: 1800,
    discountTotal: 0,
    total: 1800,
    currency: "TWD",
    createdByStaffId: "staff-001",
    completedAt: "2026-10-06T05:10:00.000Z",
    ...overrides,
  };
}

describe("Customer 360 Commerce remote-read", () => {
  it("filters remote transactions by cust-* only, never name or phone", () => {
    const rows = [
      tx(),
      tx({ id: "tx-other", customerId: OTHER, transactionNumber: "TX-20261006-0002" }),
    ];
    expect(filterCommerceTransactionsByCustomerId(rows, CUST).map((row) => row.id)).toEqual([
      "tx-remote-1",
    ]);
    expect(filterCommerceTransactionsByCustomerId(rows, "")).toEqual([]);
    const helper = read("lib/customers/customer-360.ts");
    expect(helper).toMatch(/tx\.customerId === customerId/);
    expect(helper).not.toMatch(/customerName|phone.*transaction/);
  });

  it("remote empty array wins over local transactions; null keeps local", () => {
    const remote = [tx()];
    const local = [tx({ id: "tx-local", transactionNumber: "TX-LOCAL-0001" })];
    expect(resolveCustomer360Transactions(remote, local)).toEqual(remote);
    expect(resolveCustomer360Transactions([], local)).toEqual([]);
    expect(resolveCustomer360Transactions(null, local)).toEqual(local);
    expect(resolveCustomer360Transactions(undefined, local)).toEqual(local);
  });

  it("TreatmentQuickView checkout href is canonical appointment+treatment", () => {
    const draft = createEmptyDraft({
      organizationId: ORG,
      customerId: CUST,
      appointmentId: APT,
      serviceId: "svc-muw54el4-7omtyn",
      staffId: "staff-001",
    });
    draft.id = TRT;
    draft.status = "completed";
    expect(
      resolveTreatmentQuickViewCheckoutHref({
        kind: "completed",
        appointmentId: APT,
        draft,
      }),
    ).toBe(`/staff/checkout?appointment=${APT}&treatment=${TRT}`);
    expect(
      resolveTreatmentQuickViewCheckoutHref({
        kind: "draft",
        appointmentId: APT,
        draft: { ...draft, status: "draft" },
      }),
    ).toBeNull();
    expect(
      resolveTreatmentQuickViewCheckoutHref({
        kind: "completed",
        appointmentId: APT,
        draft: null,
      }),
    ).toBeNull();
    expect(
      resolveTreatmentQuickViewCheckoutHref(
        {
          kind: "completed",
          appointmentId: APT,
          draft,
        },
        { paidAppointmentIds: new Map([[APT, "tx-20baa730d5c747"]]) },
      ),
    ).toBeNull();
  });

  it("wires Customer 360 onto commerce_list_transactions and locks Wallet writes", () => {
    const page = read("app/staff/(app)/customers/[id]/page.tsx");
    const profile = read("features/customers/CustomerProfilePage.tsx");
    const hook = read("features/customers/use-customer-360.ts");
    const wallet = read("features/customers/tabs/WalletTab.tsx");
    const txTab = read("features/customers/tabs/TransactionsTab.tsx");
    const quick = read("features/treatments/TreatmentQuickView.tsx");
    expect(page).toMatch(/await connection\(\)/);
    expect(page).toMatch(/isCommerceRemoteReadPilotEnabled/);
    expect(page).toMatch(/commerce-remote-read-flag/);
    expect(page).not.toMatch(/commerce-remote-read-pilot|createAuthenticatedCommerceReadPersistence/);
    expect(page).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(page).not.toMatch(/BEAUTY_OS_COMMERCE_REMOTE_WRITE_PILOT/);
    expect(profile).toMatch(/useCommerceRemoteTransactions/);
    expect(profile).toMatch(/filterCommerceTransactionsByCustomerId/);
    expect(profile).toMatch(/isCommerceRemoteTransactionListReady/);
    expect(profile).toMatch(/data-commerce-tx-state/);
    expect(profile).toMatch(/remoteTransactions/);
    expect(txTab).toMatch(/commerceRemoteRead \? null : \(/);
    expect(hook).toMatch(/resolveCustomer360Transactions/);
    expect(hook).toMatch(/remoteTransactions != null/);
    expect(txTab).toMatch(/commerceRemoteRead/);
    expect(txTab).toMatch(/transactionNumber/);
    expect(txTab).toMatch(/nameSnapshot/);
    expect(txTab).toMatch(/PAYMENT_METHOD_LABEL/);
    expect(txTab).toMatch(/TRANSACTION_STATUS_LABEL/);
    expect(wallet).toMatch(/commerceRemoteRead/);
    expect(wallet).toMatch(/套票尚未開放/);
    expect(wallet).toMatch(/儲值尚未開放/);
    expect(wallet).toMatch(/if \(commerceRemoteRead\) return;/);
    expect(quick).toMatch(/resolveTreatmentQuickViewCheckoutHref/);
    expect(quick).toMatch(/buildCommerceCheckoutHref|resolveTreatmentQuickViewCheckoutHref/);
    expect(quick).not.toMatch(/resolveAppointmentCheckoutNav/);
  });

  it("does not open Commerce WRITE or persist drafts from Customer 360", () => {
    for (const file of [
      "features/customers/CustomerProfilePage.tsx",
      "features/customers/tabs/TransactionsTab.tsx",
      "features/customers/tabs/WalletTab.tsx",
      "features/customers/use-customer-360.ts",
      "app/staff/(app)/customers/[id]/page.tsx",
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/hydrate_checkout_from_treatment|runAuthenticatedCommerceHydrate/);
      expect(source).not.toMatch(/settle_checkout_draft|runAuthenticatedCommerceSettle/);
      expect(source).not.toMatch(/BEAUTY_OS_COMMERCE_REMOTE_WRITE_PILOT/);
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });
});
