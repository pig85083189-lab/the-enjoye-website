import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRemoteCommerceWorkspaceItems,
  filterCheckoutItems,
  remapCheckoutSelection,
} from "@/lib/commerce/checkout-workspace-derived";
import {
  completedTransactionIdsByAppointment,
  isAppointmentSettledByTransaction,
  type CommerceCheckoutCandidate,
} from "@/lib/commerce/commerce-remote-identity";
import {
  hydrateCheckoutFromTreatment,
  settleCheckoutDraft,
  saveCheckoutDraft,
  type CommerceEngineSnapshot,
} from "@/lib/commerce/commerce-remote-engine";
import type { Transaction } from "@/lib/commerce/domain";
import {
  deriveNextAppointment,
} from "@/lib/customers/crm-derived";
import {
  deriveRecentTransactions,
  filterCommerceTransactionsByCustomerId,
  resolveCustomer360Transactions,
} from "@/lib/customers/customer-360";
import { resolveTodayPrimaryAction } from "@/lib/today/today-actions";
import {
  todayBucketFromTreatment,
  presentAppointmentStatusFromTreatment,
} from "@/lib/treatments/treatment-today";
import {
  resolveTreatmentQuickViewCheckoutHref,
  resolveTreatmentQuickViewSettledHref,
} from "@/lib/treatments/treatment-workspace-derived";
import { createEmptyDraft } from "@/lib/treatment-draft";
import type { Appointment, Customer } from "@/types";
import type { TreatmentDraft } from "@/types/treatment";

const ROOT = process.cwd();
const ORG = "org-the-enjoye";
const CUST = "cust-muvb8x0p-887ltc";
const APT = "apt-muw55olz-h64n65";
const TRT = "trt-muw6y969-aqo5o6";
const SVC = "svc-muw54el4-7omtyn";
const STAFF = "staff-001";
const LOC = "loc-enjoye-main";
const TX_ID = "tx-20baa730d5c747";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: TX_ID,
    organizationId: ORG,
    locationId: LOC,
    customerId: CUST,
    appointmentId: APT,
    treatmentId: TRT,
    checkoutDraftId: "chk-e6f38c11528b43",
    transactionNumber: "TX-20261006-0001",
    status: "COMPLETED",
    items: [
      {
        id: "cli-176e8004ea5648",
        type: "SERVICE",
        referenceId: SVC,
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
        paidAt: "2026-10-06T06:06:32.416Z",
      },
    ],
    subtotal: 1800,
    discountTotal: 0,
    total: 1800,
    currency: "TWD",
    createdByStaffId: STAFF,
    completedAt: "2026-10-06T06:06:32.416Z",
    ...over,
  };
}

function treatment(over: Partial<TreatmentDraft> = {}): TreatmentDraft {
  return {
    ...createEmptyDraft({
      organizationId: ORG,
      locationId: LOC,
      appointmentId: APT,
      customerId: CUST,
      staffId: STAFF,
      serviceId: SVC,
    }),
    id: TRT,
    status: "completed",
    ...over,
  };
}

function todayAppointment(): Appointment {
  return {
    id: APT,
    organizationId: ORG,
    locationId: LOC,
    customerId: CUST,
    customerName: "喻茗楷",
    serviceId: SVC,
    serviceName: "美波澎潤upupSPA",
    staffId: STAFF,
    staffName: "測試帳號",
    time: "12:00",
    durationMinutes: 60,
    status: "pending",
    membership: "regular",
    notes: [],
  };
}

function candidate(): CommerceCheckoutCandidate {
  return {
    identity: {
      organizationId: ORG,
      customerId: CUST,
      appointmentId: APT,
      treatmentId: TRT,
      serviceId: SVC,
      staffId: STAFF,
      locationId: LOC,
    },
    customerName: "喻茗楷",
    customerPhone: "0980929616",
    serviceName: "美波澎潤upupSPA",
    staffName: "測試帳號",
    locationId: LOC,
    startAt: "2026-10-06T04:00:00.000Z",
    durationMinutes: 60,
    appointmentStatus: "BOOKED",
    treatmentStatus: "completed",
    href: `/staff/checkout?appointment=${APT}&treatment=${TRT}`,
  };
}

function engineSnapshot(): CommerceEngineSnapshot {
  return {
    now: new Date("2026-10-06T06:06:32.416Z"),
    actor: {
      authUserId: "496f2538-8759-4038-b033-bc367e930cab",
      organizationAppId: ORG,
      organizationDbId: "f59c48df-68d1-4718-822c-f03e21aa5d9d",
      operationalStaffId: STAFF,
      role: "OWNER",
      isActive: true,
      allowedLocationAppIds: null,
    },
    appointment: {
      appId: APT,
      dbId: "833e3dfa-3842-499d-957d-95edb0396e0b",
      organizationAppId: ORG,
      organizationDbId: "f59c48df-68d1-4718-822c-f03e21aa5d9d",
      locationAppId: LOC,
      locationDbId: "1e937666-d711-4861-b07c-8354f6061f51",
      customerAppId: CUST,
      customerDbId: "980fde52-c9d9-4fd5-bf5c-9acadfb0d29d",
      serviceAppId: SVC,
      serviceDbId: "07bce7ab-10fb-4295-88f2-435fc06a99d2",
      status: "BOOKED",
    },
    treatment: {
      appId: TRT,
      dbId: "4b96e30c-ed96-4651-8b96-cc90394a555c",
      organizationDbId: "f59c48df-68d1-4718-822c-f03e21aa5d9d",
      locationDbId: "1e937666-d711-4861-b07c-8354f6061f51",
      appointmentDbId: "833e3dfa-3842-499d-957d-95edb0396e0b",
      customerDbId: "980fde52-c9d9-4fd5-bf5c-9acadfb0d29d",
      serviceDbId: "07bce7ab-10fb-4295-88f2-435fc06a99d2",
      status: "COMPLETED",
    },
    service: {
      appId: SVC,
      dbId: "07bce7ab-10fb-4295-88f2-435fc06a99d2",
      organizationDbId: "f59c48df-68d1-4718-822c-f03e21aa5d9d",
      name: "美波澎潤upupSPA",
      priceMinor: 1800,
    },
    drafts: [],
    transactions: [],
  };
}

describe("Phase 1C-6H.2P6D settlement consistency", () => {
  it("1. settled checkout cannot settle twice", () => {
    const snapshot = engineSnapshot();
    const hydrated = hydrateCheckoutFromTreatment(snapshot);
    const paid = saveCheckoutDraft(snapshot, {
      draftId: hydrated.draft.id,
      expectedUpdatedAt: hydrated.draft.updatedAt,
      payments: [{ id: "pay-cash", method: "CASH", amount: 1800 }],
      discounts: [],
    });
    const first = settleCheckoutDraft(snapshot, {
      draftId: paid.draft.id,
      expectedUpdatedAt: paid.draft.updatedAt,
    });
    const second = settleCheckoutDraft(snapshot, {
      draftId: first.draft.id,
      expectedUpdatedAt: first.draft.updatedAt,
    });
    expect(first.draft.status).toBe("COMPLETED");
    expect(second.transaction?.id).toBe(first.transaction?.id);
    expect(snapshot.transactions).toHaveLength(1);
    expect(snapshot.drafts.filter((row) => row.status === "OPEN")).toHaveLength(0);
  });

  it("2. re-enter checkout hydrates settled state", () => {
    const snapshot = engineSnapshot();
    const hydrated = hydrateCheckoutFromTreatment(snapshot);
    const paid = saveCheckoutDraft(snapshot, {
      draftId: hydrated.draft.id,
      expectedUpdatedAt: hydrated.draft.updatedAt,
      payments: [{ id: "pay-cash", method: "CASH", amount: 1800 }],
      discounts: [],
    });
    const settled = settleCheckoutDraft(snapshot, {
      draftId: paid.draft.id,
      expectedUpdatedAt: paid.draft.updatedAt,
    });
    const reentered = hydrateCheckoutFromTreatment(snapshot);
    expect(reentered.draft.id).toBe(settled.draft.id);
    expect(reentered.draft.status).toBe("COMPLETED");
    expect(reentered.transaction?.id).toBe(settled.transaction?.id);
    expect(snapshot.drafts).toHaveLength(1);
    expect(snapshot.transactions).toHaveLength(1);
  });

  it("3. completed transaction blocks duplicate payment CTA", () => {
    const paid = completedTransactionIdsByAppointment([tx()]);
    expect(isAppointmentSettledByTransaction(paid, APT)).toBe(true);
    const action = resolveTodayPrimaryAction(todayAppointment(), "BOOKED", {
      treatmentRemoteRead: true,
      commerceRemoteRead: true,
      remoteTreatment: treatment(),
      allowCheckout: true,
      paidAppointmentIds: paid,
    });
    expect(action.kind).toBe("view_record");
    if (action.kind === "view_record") {
      expect(action.label).toBe("已結帳");
      expect(action.href).toBe(`/staff/transactions?id=${TX_ID}`);
    }
    expect(
      resolveTreatmentQuickViewCheckoutHref(
        { kind: "completed", appointmentId: APT, draft: treatment() },
        { paidAppointmentIds: paid },
      ),
    ).toBeNull();
    expect(
      resolveTreatmentQuickViewSettledHref({ appointmentId: APT }, paid),
    ).toBe(`/staff/transactions?id=${TX_ID}`);
  });

  it("4. Today post-settlement state stays completed and not waiting", () => {
    expect(todayBucketFromTreatment("BOOKED", "completed")).toBe("done");
    expect(todayBucketFromTreatment("BOOKED", "completed")).not.toBe("waiting");
    expect(presentAppointmentStatusFromTreatment("BOOKED", "completed")).toBe(
      "COMPLETED",
    );
    const unpaid = resolveTodayPrimaryAction(todayAppointment(), "BOOKED", {
      treatmentRemoteRead: true,
      commerceRemoteRead: true,
      remoteTreatment: treatment(),
    });
    expect(unpaid.kind).toBe("checkout");
    const paid = resolveTodayPrimaryAction(todayAppointment(), "BOOKED", {
      treatmentRemoteRead: true,
      commerceRemoteRead: true,
      remoteTreatment: treatment(),
      paidAppointmentIds: completedTransactionIdsByAppointment([tx()]),
    });
    expect(paid.kind).toBe("view_record");
    if (paid.kind === "view_record") expect(paid.label).toBe("已結帳");
  });

  it("5. Calendar post-settlement state uses the same paid CTA", () => {
    const calendar = read("features/calendar/AppointmentQuickView.tsx");
    const page = read("features/calendar/CalendarPage.tsx");
    expect(calendar).toMatch(/paidAppointmentIds/);
    expect(page).toMatch(/completedTransactionIdsByAppointment/);
    expect(page).toMatch(/useCommerceRemoteTransactions/);
    const action = resolveTodayPrimaryAction(todayAppointment(), "BOOKED", {
      commerceRemoteRead: true,
      remoteTreatment: treatment(),
      paidAppointmentIds: completedTransactionIdsByAppointment([tx()]),
    });
    expect(action).toEqual({
      kind: "view_record",
      href: `/staff/transactions?id=${TX_ID}`,
      label: "已結帳",
    });
  });

  it("6. Customer 360 remote transaction visibility", () => {
    const rows = filterCommerceTransactionsByCustomerId(
      [tx(), tx({ id: "tx-other", customerId: "cust-other", transactionNumber: "TX-X" })],
      CUST,
    );
    expect(rows).toHaveLength(1);
    expect(resolveCustomer360Transactions(rows, [])).toEqual(rows);
    const recent = deriveRecentTransactions(rows);
    expect(recent[0]?.itemSummary).toBe("美波澎潤upupSPA");
    expect(recent[0]?.totalMinor).toBe(1800);
    expect(recent[0]?.dateLabel).toBe("2026/10/06");
  });

  it("7. Customer 360 next appointment excludes completed Treatment", () => {
    const customer: Customer = {
      id: CUST,
      organizationId: ORG,
      name: "喻茗楷",
      phone: "0980929616",
      birthday: "1990-01-01",
      age: 36,
      membership: "regular",
      lastVisit: "2026/10/06",
      totalVisits: 1,
      packages: [],
      lastServiceNotes: [],
      trackingFocus: [],
      alerts: [],
      tags: [],
      joinedAt: "2026-10-04",
      createdAt: "2026-10-04T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    expect(
      deriveNextAppointment({
        customer,
        now: new Date("2026-10-06T08:00:00.000Z"),
        appointments: [
          {
            id: APT,
            customerId: CUST,
            status: "BOOKED",
            startAt: "2026-10-06T12:00:00+08:00",
            endAt: "2026-10-06T13:00:00+08:00",
            serviceName: "美波澎潤upupSPA",
          },
        ],
        completedTreatmentAppointmentIds: [APT],
      }),
    ).toBeNull();
  });

  it("8. transaction / customer / service / staff identity remains canonical", () => {
    const row = tx();
    expect(row.customerId).toBe(CUST);
    expect(row.appointmentId).toBe(APT);
    expect(row.treatmentId).toBe(TRT);
    expect(row.items[0]?.referenceId).toBe(SVC);
    expect(row.items[0]?.nameSnapshot).toBe("美波澎潤upupSPA");
    expect(row.createdByStaffId).toBe(STAFF);
    expect(row.locationId).toBe(LOC);
    expect(row.total).toBe(1800);
    expect(row.payments[0]?.amount).toBe(1800);
    expect(row.payments[0]?.method).toBe("CASH");
  });

  it("9. no localStorage fallback under Commerce remote flags", () => {
    const files = [
      "lib/today/today-actions.ts",
      "features/today/TodayDashboard.tsx",
      "features/calendar/CalendarPage.tsx",
      "features/treatments/TreatmentQuickView.tsx",
      "features/checkout/CheckoutPageClient.tsx",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
    expect(read("features/today/TodayDashboard.tsx")).toMatch(
      /useCommerceRemoteTransactions/,
    );
    expect(read("features/today/TodayDashboard.tsx")).not.toMatch(
      /listTransactions\(|getCompletedTransactionForAppointment/,
    );
    expect(read("features/checkout/CheckoutPageClient.tsx")).toMatch(
      /appointmentIdParam \? "all" : "pending"/,
    );
  });

  it("paid workspace item is not pending and remaps the checkout URL", () => {
    const items = buildRemoteCommerceWorkspaceItems({
      candidates: [candidate()],
      transactions: [tx()],
      customers: [{ id: CUST, name: "喻茗楷", phone: "0980929616" }],
      locationId: LOC,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.paid).toBe(true);
    expect(items[0]?.status.title).toBe("已結帳");
    expect(filterCheckoutItems(items, "pending", "", "all", new Date())).toHaveLength(0);
    expect(filterCheckoutItems(items, "paid", "", "all", new Date())).toHaveLength(1);
    expect(remapCheckoutSelection(items, `appointment:${APT}`)).toBe(
      items[0]?.id,
    );
  });
});
