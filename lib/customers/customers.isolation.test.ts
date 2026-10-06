import { describe, expect, it } from "vitest";
import {
  filterCustomers,
  sortCustomers,
  type CustomerListFilter,
} from "@/features/customers/customer-list-utils";
import {
  collectCustomerAttentionNotes,
  countCustomerCrmSummary,
  customerListPresentation,
  deriveCustomerRelationshipStatus,
  deriveLastService,
  deriveNextAppointment,
  formatLastVisitRelative,
  isCustomerRowKeyboardActivation,
  isInlineCustomerQuickViewViewport,
  resolveSelectedCustomer,
  shouldRenderCustomerQuickView,
  shouldResetCustomerSelection,
  type AppointmentHint,
} from "@/lib/customers/crm-derived";
import type { Customer } from "@/types";
import { PRESET_CUSTOMER_TAGS } from "@/types/customer";

const NOW = new Date(2026, 8, 28, 13, 3, 0);

function customer(
  partial: Partial<Customer> & Pick<Customer, "id" | "name">,
): Customer {
  return {
    organizationId: "org-enjoye",
    phone: "0911-222-333",
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

const catalog = [
  { id: "svc-facial", name: "臉部保養 SPA", durationMinutes: 90 },
  { id: "svc-breast", name: "性感美胸 SPA", durationMinutes: 100 },
];

const roster: Customer[] = [
  customer({
    id: "c-stable",
    name: "林雅婷",
    membership: "regular",
    lastVisit: "2026/09/18",
    createdAt: "2025-06-01T11:00:00+08:00",
    tags: [PRESET_CUSTOMER_TAGS.regular, PRESET_CUSTOMER_TAGS.facial],
    lastServiceName: "臉部保養",
  }),
  customer({
    id: "c-vip",
    name: "黃詩涵",
    membership: "vip",
    lastVisit: "2026/09/12",
    createdAt: "2024-05-02T09:00:00+08:00",
    tags: [PRESET_CUSTOMER_TAGS.vip],
  }),
  customer({
    id: "c-follow",
    name: "王小美",
    membership: "vip",
    lastVisit: "2026/09/10",
    listStatus: "needs_follow_up",
    createdAt: "2025-03-12T10:00:00+08:00",
    tags: [PRESET_CUSTOMER_TAGS.vip, PRESET_CUSTOMER_TAGS.needs_follow_up],
  }),
  customer({
    id: "c-new",
    name: "陳欣怡",
    membership: "new",
    lastVisit: "2026/09/18",
    createdAt: "2026-09-18T09:00:00+08:00",
    joinedAt: "2026/09/18",
    tags: [PRESET_CUSTOMER_TAGS.new],
  }),
  customer({
    id: "c-dormant",
    name: "沉睡客",
    membership: "regular",
    lastVisit: "2026/07/01",
    createdAt: "2024-01-01T00:00:00+08:00",
  }),
];

describe("Customer CRM summary counts", () => {
  it("1. counts total customers from the given list", () => {
    expect(countCustomerCrmSummary(roster, NOW).total).toBe(5);
  });

  it("2. counts recent visits within 14 days", () => {
    expect(countCustomerCrmSummary(roster, NOW).recent).toBe(2);
  });

  it("3. counts new customers created this month", () => {
    expect(countCustomerCrmSummary(roster, NOW).newThisMonth).toBe(1);
    expect(countCustomerCrmSummary(roster, NOW).newCustomers).toBe(1);
  });

  it("4. counts VIP from membership or tag", () => {
    expect(countCustomerCrmSummary(roster, NOW).vip).toBe(2);
  });
});

describe("deriveCustomerRelationshipStatus", () => {
  it("5. follow-up listStatus or tag wins over VIP / recent visit", () => {
    expect(deriveCustomerRelationshipStatus(roster[2], NOW)).toBe("FOLLOW_UP");
    expect(
      deriveCustomerRelationshipStatus(
        customer({
          id: "x",
          name: "新且追蹤",
          membership: "new",
          lastVisit: "2026/07/01",
          tags: [PRESET_CUSTOMER_TAGS.needs_follow_up],
        }),
        NOW,
      ),
    ).toBe("FOLLOW_UP");
  });

  it("6. dormant when last visit is 45+ days and no follow-up/new signal", () => {
    expect(deriveCustomerRelationshipStatus(roster[4], NOW)).toBe("DORMANT");
    expect(
      deriveCustomerRelationshipStatus(
        customer({
          id: "no-visit",
          name: "無到店",
          membership: "regular",
        }),
        NOW,
      ),
    ).toBe("STABLE");
  });

  it("marks new and stable conservatively", () => {
    expect(deriveCustomerRelationshipStatus(roster[3], NOW)).toBe("NEW");
    expect(deriveCustomerRelationshipStatus(roster[0], NOW)).toBe("STABLE");
  });
});

describe("next appointment + last service", () => {
  const appointments: AppointmentHint[] = [
    {
      customerId: "c-stable",
      status: "COMPLETED",
      serviceId: "svc-facial",
      serviceName: "臉部保養 SPA",
      durationMinutes: 90,
      startAt: "2026-09-18T11:30:00+08:00",
    },
    {
      customerId: "c-follow",
      status: "BOOKED",
      serviceId: "svc-breast",
      serviceName: "性感美胸 SPA",
      durationMinutes: 100,
      startAt: "2026-09-30T14:00:00+08:00",
    },
    {
      customerId: "c-follow",
      status: "COMPLETED",
      serviceName: "性感美胸 SPA",
      durationMinutes: 100,
      startAt: "2026-09-10T10:00:00+08:00",
    },
    {
      customerId: "c-stable",
      status: "CANCELLED",
      serviceName: "臉部保養 SPA",
      startAt: "2026-10-01T10:00:00+08:00",
    },
  ];

  it("7. next appointment uses upcoming booked rows, not cancelled or past", () => {
    expect(
      deriveNextAppointment({
        customer: roster[0],
        appointments,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      deriveNextAppointment({
        customer: roster[2],
        appointments,
        now: NOW,
      }),
    ).toEqual({
      dateLabel: "2026/09/30",
      timeLabel: "14:00",
      serviceName: "性感美胸 SPA",
      startsAt: "2026-09-30T14:00:00+08:00",
    });
  });

  it("7c. UTC offset appointment is compared as an instant and labeled in Taipei", () => {
    const customerYu = customer({
      id: "cust-muvb8x0p-887ltc",
      name: "喻茗楷",
    });
    const productionUtc = {
      customerId: "cust-muvb8x0p-887ltc",
      status: "BOOKED",
      serviceName: "美波澎潤upupSPA",
      staffName: "測試帳號",
      startAt: "2026-10-06T04:00:00+00:00",
      endAt: "2026-10-06T05:00:00+00:00",
    };
    expect(
      deriveNextAppointment({
        customer: customerYu,
        appointments: [productionUtc],
        now: new Date("2026-10-06T08:00:00+08:00"),
      }),
    ).toEqual({
      dateLabel: "2026/10/06",
      timeLabel: "12:00",
      serviceName: "美波澎潤upupSPA",
      staffName: "測試帳號",
      startsAt: "2026-10-06T04:00:00+00:00",
    });
    expect(
      deriveNextAppointment({
        customer: customerYu,
        appointments: [productionUtc],
        now: new Date("2026-10-06T12:05:00+08:00"),
      })?.timeLabel,
    ).toBe("12:00");
    expect(
      deriveNextAppointment({
        customer: customerYu,
        appointments: [productionUtc],
        now: new Date("2026-10-06T13:01:00+08:00"),
      }),
    ).toBeNull();
  });

  it("7b. stale nextAppointmentAt in the past is ignored", () => {
    expect(
      deriveNextAppointment({
        customer: customer({
          id: "stale",
          name: "過期標籤",
          nextAppointmentAt: "2026-09-25T14:00:00+08:00",
          nextAppointmentLabel: "2026/09/25 14:00",
        }),
        appointments: [],
        now: NOW,
      }),
    ).toBeNull();
  });

  it("8. last service prefers completed appointment + catalog duration", () => {
    expect(
      deriveLastService({
        customer: roster[0],
        appointments,
        catalog,
      }),
    ).toEqual({
      serviceName: "臉部保養 SPA",
      durationMinutes: 90,
      dateLabel: "2026/09/18",
    });
  });

  it("8b. falls back to customer.lastServiceName + catalog match", () => {
    expect(
      deriveLastService({
        customer: roster[0],
        appointments: [],
        catalog,
      }),
    ).toEqual({
      serviceName: "臉部保養 SPA",
      durationMinutes: 90,
      dateLabel: "2026/09/18",
    });
  });
});

describe("filter + sort presentation reuse", () => {
  it("9. existing filters still isolate vip / new / follow-up / recent", () => {
    const cases: Array<[CustomerListFilter, string[]]> = [
      ["all", ["c-stable", "c-vip", "c-follow", "c-new", "c-dormant"]],
      ["vip", ["c-vip", "c-follow"]],
      ["new", ["c-new"]],
      ["needs_follow_up", ["c-follow"]],
    ];
    for (const [filter, ids] of cases) {
      expect(
        filterCustomers(roster, filter, "", NOW).map((item) => item.id),
      ).toEqual(ids);
    }
    const recent = filterCustomers(roster, "recent", "", NOW);
    expect(recent.map((item) => item.id).sort()).toEqual(["c-new", "c-stable"]);
    expect(
      filterCustomers(roster, "all", "0911", NOW).map((item) => item.id),
    ).toEqual(roster.map((item) => item.id));
    expect(
      filterCustomers(roster, "all", "林雅婷", NOW).map((item) => item.id),
    ).toEqual(["c-stable"]);
  });

  it("10. sort lastVisit / createdAt / name does not drop rows", () => {
    const byVisit = sortCustomers(roster, "lastVisit").map((item) => item.id);
    expect(byVisit[0]).toBe("c-stable");
    expect(byVisit).toHaveLength(5);
    const byCreated = sortCustomers(roster, "createdAt").map((item) => item.id);
    expect(byCreated[0]).toBe("c-new");
    const byName = sortCustomers(roster, "name").map((item) => item.name);
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b, "zh-Hant")));
  });
});

describe("Customer Quick View lifecycle", () => {
  it("11. no selection → hidden", () => {
    expect(resolveSelectedCustomer(roster, null)).toBeNull();
    expect(shouldRenderCustomerQuickView(null)).toBe(false);
  });

  it("12. click customer → open", () => {
    const selected = resolveSelectedCustomer(roster, "c-stable");
    expect(selected?.name).toBe("林雅婷");
    expect(shouldRenderCustomerQuickView(selected)).toBe(true);
  });

  it("13. selected customer content is the clicked row", () => {
    const selected = resolveSelectedCustomer(roster, "c-stable");
    expect(selected?.phone).toBe("0911-222-333");
    expect(selected?.lastServiceName).toBe("臉部保養");
  });

  it("14. click second → update in place", () => {
    const first = resolveSelectedCustomer(roster, "c-stable");
    const second = resolveSelectedCustomer(roster, "c-vip");
    expect(first?.id).toBe("c-stable");
    expect(second?.id).toBe("c-vip");
    expect(second?.name).toBe("黃詩涵");
  });

  it("15. close → hidden", () => {
    expect(resolveSelectedCustomer(roster, null)).toBeNull();
    expect(shouldRenderCustomerQuickView(null)).toBe(false);
  });

  it("16. filter hides selected → reset", () => {
    const visible = filterCustomers(roster, "vip", "", NOW);
    expect(
      shouldResetCustomerSelection({
        selectedId: "c-stable",
        visibleCustomers: visible,
      }),
    ).toBe(true);
    expect(
      shouldResetCustomerSelection({
        selectedId: "c-vip",
        visibleCustomers: visible,
      }),
    ).toBe(false);
  });

  it("17. rerender / sort preserves selection", () => {
    const sorted = sortCustomers(roster, "name");
    expect(
      shouldResetCustomerSelection({
        selectedId: "c-stable",
        visibleCustomers: sorted,
      }),
    ).toBe(false);
    expect(resolveSelectedCustomer(sorted, "c-stable")?.name).toBe("林雅婷");
  });

  it("18. keyboard Enter activates", () => {
    expect(isCustomerRowKeyboardActivation("Enter")).toBe(true);
    expect(isCustomerRowKeyboardActivation("Tab")).toBe(false);
  });

  it("19. keyboard Space activates", () => {
    expect(isCustomerRowKeyboardActivation(" ")).toBe(true);
    expect(isCustomerRowKeyboardActivation("Escape")).toBe(false);
  });

  it("20. mobile presentation contract uses 1200 breakpoint", () => {
    expect(isInlineCustomerQuickViewViewport(1199)).toBe(false);
    expect(isInlineCustomerQuickViewViewport(1200)).toBe(true);
    expect(isInlineCustomerQuickViewViewport(1536)).toBe(true);
    expect(customerListPresentation(390)).toBe("mobile-cards");
    expect(customerListPresentation(820)).toBe("mobile-cards");
    expect(customerListPresentation(1536)).toBe("desktop-table");
  });
});

describe("formatLastVisitRelative + attention", () => {
  it("formats slash date and relative day outside JSX", () => {
    expect(formatLastVisitRelative("2026/09/18", NOW)).toEqual({
      dateLabel: "2026/09/18",
      relativeLabel: "10 天前",
    });
    expect(formatLastVisitRelative("2026/09/28", NOW).relativeLabel).toBe("今天");
    expect(formatLastVisitRelative("", NOW).dateLabel).toBeNull();
  });

  it("attention uses real notes and skips empty/success alerts", () => {
    const notes = collectCustomerAttentionNotes(
      customer({
        id: "attn",
        name: "注意",
        importantNotes: ["敏感肌"],
        lastServiceNotes: ["右側腋下較緊"],
        trackingFocus: ["經期前容易脹痛"],
        alerts: [
          { id: "a1", customerId: "attn", label: "懷孕", value: "否", tone: "success" },
          { id: "a2", customerId: "attn", label: "特殊備註", value: "無", tone: "neutral" },
          { id: "a3", customerId: "attn", label: "精油敏感", value: "較敏感", tone: "warning" },
        ],
      }),
    );
    expect(notes).toEqual([
      "敏感肌",
      "較敏感",
      "右側腋下較緊",
      "經期前容易脹痛",
    ]);
  });
});
