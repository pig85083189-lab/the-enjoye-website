import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import type { Transaction } from "@/lib/commerce/domain";
import {
  CUSTOMER_360_FREQUENT_LIMIT,
  CUSTOMER_360_TIMELINE_PREVIEW,
  customerCreateAppointmentHref,
  deriveCustomerTimeline,
  deriveFrequentServices,
  deriveLastVisitLabel,
  derivePackageFinancialCards,
  derivePrimaryServiceName,
  deriveRecentTransactions,
  deriveServiceFocus,
  hasServiceFocus,
  isCustomer360TabId,
  isCustomerProfileWorkbenchPath,
  isFinancialTab,
  previewPackages,
  previewTimeline,
} from "@/lib/customers/customer-360";
import type { CustomerPackage } from "@/lib/packages/domain";
import type { FollowUpTask } from "@/lib/follow-ups/domain";
import { createEmptyDraft } from "@/lib/treatment-draft";
import type { Customer, Service } from "@/types";
import type { CustomerConsultation } from "@/types/customer";
import type { TreatmentDraft } from "@/types/treatment";

const ORG = "org-the-enjoye";

function customer(
  partial: Partial<Customer> & Pick<Customer, "id" | "name">,
): Customer {
  return {
    organizationId: ORG,
    phone: "0912-345-678",
    birthday: "",
    age: 0,
    membership: "regular",
    lastVisit: "",
    totalVisits: 0,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [],
    joinedAt: "",
    createdAt: "2025-01-01T00:00:00+08:00",
    updatedAt: "2026-09-01T00:00:00+08:00",
    ...partial,
  };
}

function treatment(
  partial: Partial<TreatmentDraft> & Pick<TreatmentDraft, "appointmentId" | "serviceId">,
): TreatmentDraft {
  return {
    ...createEmptyDraft({
      organizationId: ORG,
      appointmentId: partial.appointmentId,
      customerId: "c-1",
      staffId: "staff-001",
      serviceId: partial.serviceId,
    }),
    ...partial,
  };
}

function apt(
  partial: Partial<ScheduleAppointment> & Pick<ScheduleAppointment, "id" | "startAt" | "status">,
): ScheduleAppointment {
  return {
    organizationId: ORG,
    locationId: "loc-main",
    customerId: "c-1",
    customerName: "王小美",
    serviceId: "svc-facial",
    serviceName: "臉部保養 SPA",
    staffId: "staff-001",
    staffName: "怡蓁",
    endAt: partial.startAt,
    durationMinutes: 90,
    notes: [],
    createdAt: "2026-09-01T00:00:00+08:00",
    updatedAt: "2026-09-01T00:00:00+08:00",
    ...partial,
  };
}

const catalog: Service[] = [
  {
    id: "svc-facial",
    organizationId: ORG,
    name: "臉部保養 SPA",
    durationMinutes: 90,
    category: "臉部",
    serviceType: "FACIAL",
    priceMinor: 2800,
  },
  {
    id: "svc-breast",
    organizationId: ORG,
    name: "性感美胸 SPA",
    durationMinutes: 100,
    category: "美胸",
    serviceType: "BREAST",
    priceMinor: 3200,
  },
  {
    id: "svc-body",
    organizationId: ORG,
    name: "身體舒壓",
    durationMinutes: 60,
    category: "身體",
    serviceType: "BODY_SCULPTING",
  },
];

describe("Customer 360 tab + path helpers", () => {
  it("keeps legacy tab ids including notes / wallet / transactions", () => {
    expect(isCustomer360TabId("overview")).toBe(true);
    expect(isCustomer360TabId("notes")).toBe(true);
    expect(isCustomer360TabId("wallet")).toBe(true);
    expect(isCustomer360TabId("bogus")).toBe(false);
    expect(isFinancialTab("wallet")).toBe(true);
    expect(isFinancialTab("treatments")).toBe(false);
  });

  it("profile workbench path excludes new / edit / consultation", () => {
    expect(isCustomerProfileWorkbenchPath("/staff/customers/demo-001")).toBe(true);
    expect(isCustomerProfileWorkbenchPath("/staff/customers")).toBe(false);
    expect(isCustomerProfileWorkbenchPath("/staff/customers/new")).toBe(false);
    expect(isCustomerProfileWorkbenchPath("/staff/customers/demo-001/edit")).toBe(false);
    expect(
      isCustomerProfileWorkbenchPath("/staff/customers/demo-001/consultation/new"),
    ).toBe(false);
  });

  it("create appointment href reuses calendar create query", () => {
    expect(customerCreateAppointmentHref("demo-001")).toBe(
      "/staff/calendar?create=1&customer=demo-001",
    );
  });
});

describe("deriveServiceFocus", () => {
  it("returns empty when no notes / treatment / consultation signals", () => {
    const focus = deriveServiceFocus({ customer: customer({ id: "c-empty", name: "空" }) });
    expect(hasServiceFocus(focus)).toBe(false);
    expect(focus).toEqual({
      conditionNotes: [],
      lastBeauticianNote: null,
      suggestions: [],
    });
  });

  it("derives condition, beautician note, and tracking from real fields only", () => {
    const focus = deriveServiceFocus({
      customer: customer({
        id: "c-1",
        name: "王小美",
        lastServiceNotes: ["T 字部位出油", "兩頰乾燥"],
        trackingFocus: ["右腋下", "外擴狀況"],
      }),
      latestTreatment: treatment({
        appointmentId: "apt-1",
        serviceId: "svc-facial",
        status: "completed",
        professionalNote: "右側較緊，持續追蹤。",
        assessment: {
          concerns: ["T 字部位出油"],
          clientFocus: "保濕",
          sensitivityLevel: 1,
        },
      }),
      latestConsultation: {
        id: "con-1",
        organizationId: ORG,
        customerId: "c-1",
        kind: "update",
        title: "諮詢更新",
        goals: [],
        healthItems: [
          { id: "h1", label: "敏感肌", checked: true, note: "精油" },
          { id: "h2", label: "懷孕", checked: false },
        ],
        customerConfirmed: true,
        consultedAt: "2026-09-10T10:00:00+08:00",
        consultedBy: "staff-001",
        consultedByName: "怡蓁",
        createdAt: "2026-09-10T10:00:00+08:00",
        updatedAt: "2026-09-10T10:00:00+08:00",
      } satisfies CustomerConsultation,
    });
    expect(hasServiceFocus(focus)).toBe(true);
    expect(focus.conditionNotes).toEqual(["T 字部位出油", "兩頰乾燥", "保濕", "敏感肌：精油"]);
    expect(focus.lastBeauticianNote).toBe("右側較緊，持續追蹤。");
    expect(focus.suggestions).toEqual(["右腋下", "外擴狀況"]);
  });
});

describe("deriveFrequentServices", () => {
  it("sorts by usage count DESC then last used DESC, max 3, skips drafts", () => {
    const rows = deriveFrequentServices({
      treatments: [
        treatment({
          id: "t-draft",
          appointmentId: "apt-d",
          serviceId: "svc-body",
          status: "draft",
          updatedAt: "2026-09-28T10:00:00+08:00",
        }),
        treatment({
          id: "t1",
          appointmentId: "apt-1",
          serviceId: "svc-facial",
          status: "completed",
          updatedAt: "2026-09-10T11:00:00+08:00",
        }),
        treatment({
          id: "t2",
          appointmentId: "apt-2",
          serviceId: "svc-facial",
          status: "completed",
          updatedAt: "2026-09-18T11:00:00+08:00",
        }),
        treatment({
          id: "t3",
          appointmentId: "apt-3",
          serviceId: "svc-breast",
          status: "completed",
          updatedAt: "2026-09-12T11:00:00+08:00",
        }),
      ],
      appointments: [
        apt({
          id: "apt-1",
          status: "COMPLETED",
          startAt: "2026-09-10T11:00:00+08:00",
        }),
        apt({
          id: "apt-4",
          status: "COMPLETED",
          serviceId: "svc-body",
          serviceName: "身體舒壓",
          startAt: "2026-09-20T14:00:00+08:00",
        }),
        apt({
          id: "apt-booked",
          status: "BOOKED",
          serviceId: "svc-breast",
          startAt: "2026-10-01T10:00:00+08:00",
        }),
        apt({
          id: "apt-5",
          status: "COMPLETED",
          serviceId: "svc-facial",
          startAt: "2026-09-01T10:00:00+08:00",
        }),
      ],
      catalog,
    });
    expect(rows).toHaveLength(CUSTOMER_360_FREQUENT_LIMIT);
    expect(rows.map((row) => row.serviceId)).toEqual([
      "svc-facial",
      "svc-body",
      "svc-breast",
    ]);
    expect(rows[0].usageCount).toBe(3);
    expect(rows[0].lastUsedLabel).toBe("2026/09/18");
    expect(rows[0].durationMinutes).toBe(90);
    expect(rows[0].priceMinor).toBe(2800);
    expect(rows[1].priceMinor).toBeNull();
    expect(rows[1].usageCount).toBe(1);
  });

  it("returns empty when there is no completed history", () => {
    expect(
      deriveFrequentServices({
        treatments: [
          treatment({
            appointmentId: "apt-d",
            serviceId: "svc-facial",
            status: "draft",
          }),
        ],
        appointments: [
          apt({ id: "apt-b", status: "BOOKED", startAt: "2026-10-01T10:00:00+08:00" }),
        ],
        catalog,
      }),
    ).toEqual([]);
  });
});

describe("timeline + last visit", () => {
  it("sorts newest first and previews 5 items", () => {
    const items = deriveCustomerTimeline({
      customerId: "c-1",
      treatments: [
        treatment({
          id: "t1",
          appointmentId: "apt-1",
          serviceId: "svc-facial",
          status: "completed",
          professionalNote: "右側較緊",
          updatedAt: "2026-09-18T11:30:00+08:00",
        }),
      ],
      appointments: [
        apt({
          id: "apt-1",
          status: "COMPLETED",
          startAt: "2026-09-18T11:30:00+08:00",
        }),
        apt({
          id: "apt-old",
          status: "COMPLETED",
          serviceId: "svc-body",
          serviceName: "身體舒壓",
          startAt: "2026-08-01T10:00:00+08:00",
          durationMinutes: 60,
          staffName: "怡蓁",
        }),
      ],
      followUps: [
        {
          id: "fu-1",
          organizationId: ORG,
          customerId: "c-1",
          dueAt: "2026-09-20T10:00:00+08:00",
          status: "OPEN",
          type: "TREATMENT_FOLLOW_UP",
          note: "追蹤右腋下",
          context: { followUpTags: ["右腋下"], serviceName: "臉部保養 SPA", staffName: "怡蓁" },
          createdAt: "2026-09-18T12:00:00+08:00",
          updatedAt: "2026-09-18T12:00:00+08:00",
        } satisfies FollowUpTask,
      ],
      consultations: [],
      transactions: [
        {
          id: "tx-void",
          organizationId: ORG,
          locationId: "loc-main",
          customerId: "c-1",
          transactionNumber: "TX-VOID",
          items: [{ id: "i", type: "SERVICE", nameSnapshot: "作廢", unitPrice: 1, quantity: 1, lineSubtotal: 1, discountAmount: 0, lineTotal: 1 }],
          discounts: [],
          payments: [],
          subtotal: 1,
          discountTotal: 0,
          total: 1,
          currency: "TWD",
          status: "VOIDED",
          completedAt: "2026-09-19T10:00:00+08:00",
          createdByStaffId: "staff-001",
        } as Transaction,
        {
          id: "tx-ok",
          organizationId: ORG,
          locationId: "loc-main",
          customerId: "c-1",
          transactionNumber: "TX-OK",
          items: [{ id: "i", type: "SERVICE", nameSnapshot: "臉部保養 SPA", unitPrice: 2800, quantity: 1, lineSubtotal: 2800, discountAmount: 0, lineTotal: 2800 }],
          discounts: [],
          payments: [],
          subtotal: 2800,
          discountTotal: 0,
          total: 2800,
          currency: "TWD",
          status: "COMPLETED",
          completedAt: "2026-09-18T12:30:00+08:00",
          createdByStaffId: "staff-001",
        } as Transaction,
      ],
      catalog,
      staffNameById: { "staff-001": "怡蓁" },
    });
    expect(items.map((item) => item.type)).toEqual([
      "transaction",
      "follow_up",
      "treatment_completed",
      "appointment_completed",
    ]);
    expect(items.find((item) => item.type === "appointment_completed")?.id).toBe(
      "appointment:apt-old",
    );
    expect(items.find((item) => item.type === "treatment_completed")?.staffName).toBe("怡蓁");
    expect(items.some((item) => item.id === "transaction:tx-void")).toBe(false);
    expect(previewTimeline(items)).toHaveLength(Math.min(CUSTOMER_360_TIMELINE_PREVIEW, items.length));
  });

  it("last visit prefers completed history then customer.lastVisit", () => {
    expect(
      deriveLastVisitLabel({
        customer: customer({ id: "c-1", name: "A", lastVisit: "2026/07/01" }),
        appointments: [
          apt({ id: "a1", status: "COMPLETED", startAt: "2026-09-10T11:00:00+08:00" }),
        ],
        treatments: [],
      }),
    ).toBe("2026/09/10");
    expect(
      deriveLastVisitLabel({
        customer: customer({ id: "c-2", name: "B", lastVisit: "2026/07/01" }),
        appointments: [],
        treatments: [],
      }),
    ).toBe("2026/07/01");
  });
});

describe("financial presentation uses ledger truth", () => {
  const pkg: CustomerPackage = {
    id: "cp-1",
    organizationId: ORG,
    customerId: "c-1",
    packageDefinitionId: "def-1",
    nameSnapshot: "美胸 10 堂",
    sessionCountSnapshot: 10,
    priceSnapshot: 28000,
    includedServiceIdsSnapshot: ["svc-breast"],
    purchasedAt: "2026-08-01T10:00:00+08:00",
    expiresAt: "2026-12-01T00:00:00+08:00",
    status: "ACTIVE",
    createdAt: "2026-08-01T10:00:00+08:00",
    updatedAt: "2026-08-01T10:00:00+08:00",
  };

  it("package remaining comes from getUsable, never remainingSessions residue", () => {
    const cards = derivePackageFinancialCards(ORG, [pkg], () => ({
      ledgerBalance: 7,
      usableBalance: 7,
      status: "ACTIVE",
    }));
    expect(cards[0].usableBalance).toBe(7);
    expect(cards[0].usedSessions).toBe(3);
    expect(cards[0].sessionCountSnapshot).toBe(10);
    expect(cards[0].expiresAtLabel).toBe("2026/12/01");
    expect(JSON.stringify(cards)).not.toMatch(/remainingSessions/);
  });

  it("expired usable 0 still reports ledger used sessions from snapshot − ledger", () => {
    const cards = derivePackageFinancialCards(ORG, [pkg], () => ({
      ledgerBalance: 4,
      usableBalance: 0,
      status: "EXPIRED",
    }));
    expect(cards[0].usableBalance).toBe(0);
    expect(cards[0].usedSessions).toBe(6);
    expect(cards[0].status).toBe("EXPIRED");
  });

  it("preview packages prefer higher usable balance", () => {
    const cards = derivePackageFinancialCards(
      ORG,
      [
        { ...pkg, id: "cp-low", nameSnapshot: "低", sessionCountSnapshot: 5 },
        { ...pkg, id: "cp-high", nameSnapshot: "高", sessionCountSnapshot: 8 },
      ],
      (_org, id) =>
        id === "cp-high"
          ? { ledgerBalance: 6, usableBalance: 6, status: "ACTIVE" }
          : { ledgerBalance: 1, usableBalance: 1, status: "ACTIVE" },
    );
    expect(previewPackages(cards, 1)[0].customerPackageId).toBe("cp-high");
  });

  it("recent transactions skip VOIDED and cap at 3", () => {
    const txs = [1, 2, 3, 4].map((n) => ({
      id: `tx-${n}`,
      organizationId: ORG,
      locationId: "loc-main",
      customerId: "c-1",
      transactionNumber: `TX-${n}`,
      items: [
        {
          id: "i",
          type: "SERVICE" as const,
          nameSnapshot: `項目${n}`,
          unitPrice: n * 100,
          quantity: 1,
          lineSubtotal: n * 100,
          discountAmount: 0,
          lineTotal: n * 100,
        },
      ],
      discounts: [],
      payments: [],
      subtotal: n * 100,
      discountTotal: 0,
      total: n * 100,
      currency: "TWD",
      status: n === 2 ? ("VOIDED" as const) : ("COMPLETED" as const),
      completedAt: `2026-09-0${n}T10:00:00+08:00`,
      createdByStaffId: "staff-001",
    })) as Transaction[];
    const rows = deriveRecentTransactions(txs);
    expect(rows.map((row) => row.id)).toEqual(["tx-4", "tx-3", "tx-1"]);
    expect(rows).toHaveLength(3);
  });

  it("primary service name uses frequent history then lastServiceName", () => {
    expect(
      derivePrimaryServiceName(
        [{ serviceId: "svc-facial", serviceName: "臉部保養 SPA", usageCount: 2, lastUsedAt: "", lastUsedLabel: "", durationMinutes: 90, priceMinor: 2800 }],
        customer({ id: "c", name: "A", lastServiceName: "美胸保養" }),
      ),
    ).toBe("臉部保養 SPA");
    expect(
      derivePrimaryServiceName([], customer({ id: "c", name: "A", lastServiceName: "美胸保養" })),
    ).toBe("美胸保養");
    expect(derivePrimaryServiceName([], customer({ id: "c", name: "A" }))).toBeNull();
  });
});

describe("Customer 360 source contracts", () => {
  it("UI reads existing stores and does not invent a second financial SoT", () => {
    const helper = readFileSync(path.join(process.cwd(), "lib/customers/customer-360.ts"), "utf8");
    const page = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerProfilePage.tsx"),
      "utf8",
    );
    const hook = readFileSync(
      path.join(process.cwd(), "features/customers/use-customer-360.ts"),
      "utf8",
    );
    const overview = readFileSync(
      path.join(process.cwd(), "features/customers/tabs/OverviewTab.tsx"),
      "utf8",
    );
    const summary = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerSummaryPanel.tsx"),
      "utf8",
    );
    const wallet = readFileSync(
      path.join(process.cwd(), "features/customers/tabs/WalletTab.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      path.join(process.cwd(), "components/layout/StaffShell.tsx"),
      "utf8",
    );

    expect(helper).not.toMatch(/localStorage/);
    expect(helper).toMatch(/getUsable/);
    expect(helper).not.toMatch(/remainingSessions/);
    expect(page).not.toMatch(/localStorage\.(get|set)Item/);
    expect(hook).not.toMatch(/localStorage\.(get|set)Item/);
    expect(hook).toMatch(/getPackageUsableBalance/);
    expect(hook).toMatch(/getCustomerStoredValueBalance/);
    expect(hook).toMatch(/listTransactions/);
    expect(hook).toMatch(/listCustomerPackages/);
    expect(hook).not.toMatch(/customer\.packages/);
    expect(overview).not.toMatch(/localStorage\.(get|set)Item/);
    expect(overview).not.toMatch(/customer\.packages/);
    expect(overview).not.toMatch(/customer\.balance/);
    expect(summary).not.toMatch(/remainingSessions/);
    expect(wallet).toMatch(/getPackageUsableBalance/);
    expect(wallet).toMatch(/getCustomerStoredValueBalance/);
    expect(wallet).toMatch(/listTransactions/);
    expect(shell).toMatch(/isCustomerProfileWorkbenchPath/);
    expect(shell).toMatch(/w-\[254px\]/);
    expect(shell).toMatch(/w-\[232px\]/);
  });
});
