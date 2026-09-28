import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { serviceTypeCardTone } from "@/features/calendar/grid-shared";
import { createEmptyDraft } from "@/lib/treatment-draft";
import {
  buildTreatmentWorkspaceItems,
  collectTreatmentAttentionNotes,
  countTreatmentWorkspaceSummary,
  deriveLastCompletedTreatment,
  deriveRecordProgress,
  deriveTreatmentEmptyState,
  deriveTreatmentPrimaryCta,
  deriveTreatmentStatus,
  filterTreatmentItems,
  isInlineTreatmentQuickViewViewport,
  isTreatmentRowKeyboardActivation,
  resolveSelectedTreatment,
  shouldRenderTreatmentQuickView,
  shouldResetTreatmentSelection,
  shouldShowCheckoutCta,
  treatmentListPresentation,
  treatmentServiceTint,
  type TreatmentCatalogHint,
  type TreatmentWorkspaceItem,
} from "@/lib/treatments/treatment-workspace-derived";
import type { Customer } from "@/types";
import type { TreatmentDraft } from "@/types/treatment";
import { PRESET_CUSTOMER_TAGS } from "@/types/customer";

const NOW = new Date(2026, 8, 28, 10, 40, 0);
const ORG = "org-the-enjoye";
const LOC = "loc-enjoye-main";

const catalog: TreatmentCatalogHint[] = [
  {
    id: "svc-breast",
    name: "性感美胸 SPA",
    durationMinutes: 100,
    serviceType: "BREAST",
    category: "美胸",
  },
  {
    id: "svc-facial",
    name: "臉部保養 SPA",
    durationMinutes: 90,
    serviceType: "FACIAL",
    category: "臉部",
  },
  {
    id: "svc-curve",
    name: "窈窕曲線 SPA",
    durationMinutes: 100,
    serviceType: "BODY_SCULPTING",
    category: "曲線",
  },
];

function customer(
  partial: Partial<Customer> & Pick<Customer, "id" | "name">,
): Customer {
  return {
    organizationId: ORG,
    phone: "",
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

function apt(
  partial: Partial<ScheduleAppointment> &
    Pick<ScheduleAppointment, "id" | "startAt" | "endAt" | "status">,
): ScheduleAppointment {
  return {
    organizationId: ORG,
    locationId: LOC,
    customerId: "c-1",
    customerName: "王小美",
    serviceId: "svc-breast",
    serviceName: "性感美胸 SPA",
    staffId: "staff-001",
    staffName: "怡蓁",
    durationMinutes: 100,
    notes: [],
    createdAt: "2026-09-28T00:00:00+08:00",
    updatedAt: "2026-09-28T00:00:00+08:00",
    ...partial,
  };
}

function draft(
  partial: Partial<TreatmentDraft> &
    Pick<TreatmentDraft, "appointmentId" | "customerId">,
): TreatmentDraft {
  const base = createEmptyDraft({
    organizationId: ORG,
    locationId: LOC,
    appointmentId: partial.appointmentId,
    customerId: partial.customerId,
    staffId: partial.staffId ?? "staff-001",
    serviceId: partial.serviceId ?? "svc-breast",
  });
  return { ...base, ...partial, id: partial.id ?? base.id };
}

const wang = customer({
  id: "c-1",
  name: "王小美",
  phone: "0912-345-678",
  membership: "vip",
  totalVisits: 12,
  tags: [PRESET_CUSTOMER_TAGS.vip],
  importantNotes: ["對精油較敏感", "右腋下近期較緊"],
  lastServiceNotes: ["右側腋下較緊", "外擴", "經期前容易脹痛"],
  trackingFocus: ["外擴追蹤"],
});

const lin = customer({
  id: "c-2",
  name: "林雅婷",
  phone: "0911-222-333",
  membership: "regular",
});

const chen = customer({
  id: "c-3",
  name: "陳欣怡",
  phone: "0910-000-111",
  membership: "new",
  tags: [PRESET_CUSTOMER_TAGS.new],
});

const customers = [wang, lin, chen];

const inProgressApt = apt({
  id: "apt-now",
  customerId: "c-1",
  customerName: "王小美",
  startAt: new Date(2026, 8, 28, 10, 0).toISOString(),
  endAt: new Date(2026, 8, 28, 11, 40).toISOString(),
  status: "IN_SERVICE",
});

const laterApt = apt({
  id: "apt-later",
  customerId: "c-3",
  customerName: "陳欣怡",
  serviceId: "svc-curve",
  serviceName: "窈窕曲線 SPA",
  startAt: new Date(2026, 8, 28, 14, 0).toISOString(),
  endAt: new Date(2026, 8, 28, 15, 40).toISOString(),
  status: "BOOKED",
});

const completedNoRecordApt = apt({
  id: "apt-done",
  customerId: "c-2",
  customerName: "林雅婷",
  serviceId: "svc-facial",
  serviceName: "臉部保養 SPA",
  staffName: "語安",
  startAt: new Date(2026, 8, 28, 8, 0).toISOString(),
  endAt: new Date(2026, 8, 28, 9, 30).toISOString(),
  status: "COMPLETED",
});

const yesterdayCompletedApt = apt({
  id: "apt-yesterday",
  customerId: "c-1",
  customerName: "王小美",
  startAt: new Date(2026, 8, 27, 10, 0).toISOString(),
  endAt: new Date(2026, 8, 27, 11, 40).toISOString(),
  status: "COMPLETED",
});

const openDraft = draft({
  appointmentId: "apt-now",
  customerId: "c-1",
  bodyMapNote: "右腋下偏緊",
  photos: [
    {
      id: "p1",
      treatmentId: "treatment-apt-now",
      type: "BEFORE",
      createdAt: "2026-09-28T10:10:00+08:00",
      hadPreview: true,
    },
  ],
});

const completedTreatment = draft({
  id: "treatment-seed-yesterday",
  appointmentId: "apt-yesterday",
  customerId: "c-1",
  status: "completed",
  currentStep: "complete",
  professionalNote: "右側較緊，持續追蹤。",
  updatedAt: "2026-09-27T11:40:00+08:00",
  createdAt: "2026-09-27T10:00:00+08:00",
});

const completedTodayTreatment = draft({
  id: "treatment-today",
  appointmentId: "apt-today-done",
  customerId: "c-3",
  serviceId: "svc-curve",
  status: "completed",
  currentStep: "complete",
  professionalNote: "曲線維持良好。",
  updatedAt: "2026-09-28T09:20:00+08:00",
  createdAt: "2026-09-28T08:00:00+08:00",
});

const completedTodayApt = apt({
  id: "apt-today-done",
  customerId: "c-3",
  customerName: "陳欣怡",
  serviceId: "svc-curve",
  serviceName: "窈窕曲線 SPA",
  startAt: new Date(2026, 8, 28, 8, 0).toISOString(),
  endAt: new Date(2026, 8, 28, 9, 20).toISOString(),
  status: "COMPLETED",
});

function workspace(overrides?: {
  openDrafts?: TreatmentDraft[];
  completedTreatments?: TreatmentDraft[];
  appointments?: ScheduleAppointment[];
  now?: Date;
}): TreatmentWorkspaceItem[] {
  return buildTreatmentWorkspaceItems({
    openDrafts: overrides?.openDrafts ?? [openDraft],
    completedTreatments: overrides?.completedTreatments ?? [
      completedTreatment,
      completedTodayTreatment,
    ],
    appointments: overrides?.appointments ?? [
      inProgressApt,
      laterApt,
      completedNoRecordApt,
      yesterdayCompletedApt,
      completedTodayApt,
    ],
    customers,
    catalog,
    now: overrides?.now ?? NOW,
  });
}

describe("Treatment workspace summary counts", () => {
  it("1. summary counts derived 正確", () => {
    const items = workspace();
    const summary = countTreatmentWorkspaceSummary(items, NOW);
    expect(summary.today).toBe(4);
    expect(summary.inProgress).toBe(1);
    expect(summary.incompleteRecords).toBe(1);
    expect(summary.completedToday).toBe(1);
  });
});

describe("Treatment list filters + search", () => {
  it("2. active treatment filter", () => {
    const visible = filterTreatmentItems(workspace(), "open", "", "all", NOW);
    expect(visible.some((item) => item.status.kind === "in_progress")).toBe(true);
    expect(visible.every((item) => item.kind !== "completed")).toBe(true);
    expect(visible.some((item) => item.appointmentId === "apt-later")).toBe(true);
  });

  it("3. completed filter", () => {
    const visible = filterTreatmentItems(
      workspace(),
      "completed",
      "",
      "all",
      NOW,
    );
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((item) => item.kind === "completed")).toBe(true);
  });

  it("4. search customer", () => {
    const visible = filterTreatmentItems(
      workspace(),
      "all",
      "王小美",
      "all",
      NOW,
    );
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((item) => item.customerName.includes("王小美"))).toBe(
      true,
    );
  });

  it("5. search service", () => {
    const visible = filterTreatmentItems(
      workspace(),
      "all",
      "臉部保養",
      "all",
      NOW,
    );
    expect(visible.map((item) => item.serviceName)).toEqual(["臉部保養 SPA"]);
  });

  it("6. search staff", () => {
    const visible = filterTreatmentItems(workspace(), "all", "語安", "all", NOW);
    expect(visible.map((item) => item.staffName)).toEqual(["語安"]);
  });
});

describe("Treatment completion derived", () => {
  it("7. treatment completion derived from real draft sections", () => {
    const progress = deriveRecordProgress(openDraft);
    expect(progress.totalCount).toBe(4);
    expect(progress.completedCount).toBe(2);
    expect(progress.sections.find((s) => s.id === "bodyMap")?.complete).toBe(
      true,
    );
    expect(progress.sections.find((s) => s.id === "photos")?.complete).toBe(
      true,
    );
    expect(
      progress.sections.find((s) => s.id === "professionalNote")?.complete,
    ).toBe(false);
    expect(progress.sections.find((s) => s.id === "followUp")?.complete).toBe(
      false,
    );
    expect(progress.isIncomplete).toBe(true);
  });
});

describe("Treatment selection + Quick View", () => {
  it("8. click row → selectedTreatmentId", () => {
    const items = workspace();
    const selectedId = items.find((item) => item.appointmentId === "apt-now")?.id;
    expect(selectedId).toBe("draft:treatment-apt-now");
  });

  it("9. selection → QV render", () => {
    const items = workspace();
    const selected = resolveSelectedTreatment(items, "draft:treatment-apt-now");
    expect(shouldRenderTreatmentQuickView(selected)).toBe(true);
    expect(selected?.customerName).toBe("王小美");
  });

  it("10. click second treatment → QV update", () => {
    const items = workspace();
    const first = resolveSelectedTreatment(items, "draft:treatment-apt-now");
    const secondId = items.find((item) => item.appointmentId === "apt-later")?.id;
    const second = resolveSelectedTreatment(items, secondId ?? null);
    expect(first?.id).not.toBe(second?.id);
    expect(second?.customerName).toBe("陳欣怡");
    expect(second?.serviceName).toBe("窈窕曲線 SPA");
  });

  it("11. close → QV disappear", () => {
    expect(shouldRenderTreatmentQuickView(null)).toBe(false);
    expect(resolveSelectedTreatment(workspace(), null)).toBeNull();
  });

  it("12. filter hides selected → reset", () => {
    const items = workspace();
    const open = filterTreatmentItems(items, "open", "", "all", NOW);
    const selectedId = items.find((item) => item.kind === "completed")?.id ?? null;
    expect(
      shouldResetTreatmentSelection({ selectedId, visibleItems: open }),
    ).toBe(true);
  });

  it("13. rerender → selection remains", () => {
    const first = workspace();
    const selectedId = "draft:treatment-apt-now";
    expect(
      shouldResetTreatmentSelection({
        selectedId,
        visibleItems: filterTreatmentItems(first, "open", "", "all", NOW),
      }),
    ).toBe(false);
    const rerender = workspace();
    expect(
      shouldResetTreatmentSelection({
        selectedId,
        visibleItems: filterTreatmentItems(rerender, "open", "", "all", NOW),
      }),
    ).toBe(false);
    expect(resolveSelectedTreatment(rerender, selectedId)?.id).toBe(selectedId);
  });
});

describe("Attention / last treatment / tint / CTA / empty / responsive", () => {
  it("14. attention dedupe", () => {
    const notes = collectTreatmentAttentionNotes({
      customer: wang,
      appointmentNotes: ["右側腋下較緊", "外擴需持續追蹤"],
      currentDraft: openDraft,
      latestCompleted: completedTreatment,
    });
    expect(notes).toContain("對精油較敏感");
    expect(notes).toContain("右側腋下較緊");
    expect(new Set(notes).size).toBe(notes.length);
    expect(notes.filter((note) => note === "右側腋下較緊").length).toBe(1);
  });

  it("15. last treatment derived", () => {
    const last = deriveLastCompletedTreatment({
      completedTreatments: [completedTreatment, completedTodayTreatment],
      customerId: "c-1",
      catalog,
      excludeAppointmentId: "apt-now",
    });
    expect(last?.serviceName).toBe("性感美胸 SPA");
    expect(last?.note).toBe("右側較緊，持續追蹤。");
    expect(
      deriveLastCompletedTreatment({
        completedTreatments: [],
        customerId: "c-1",
        catalog,
      }),
    ).toBeNull();
  });

  it("16. service tint mapping", () => {
    expect(treatmentServiceTint("BREAST")).toEqual(serviceTypeCardTone("BREAST"));
    expect(treatmentServiceTint("BODY_SCULPTING")).toEqual(
      serviceTypeCardTone("BODY_SCULPTING"),
    );
    expect(treatmentServiceTint("FACIAL")).toEqual(serviceTypeCardTone("FACIAL"));
    expect(treatmentServiceTint("WOMB_CARE")).toBeNull();
    expect(treatmentServiceTint(undefined)).toBeNull();
  });

  it("17. checkout CTA only when valid", () => {
    expect(shouldShowCheckoutCta({ kind: "none" })).toBe(false);
    expect(
      shouldShowCheckoutCta({
        kind: "view_transaction",
        href: "/staff/transactions?id=tx-1",
        label: "查看交易",
        transactionNumber: "T-1",
      }),
    ).toBe(false);
    expect(
      shouldShowCheckoutCta({
        kind: "checkout",
        href: "/staff/checkout?appointment=apt-now",
      }),
    ).toBe(true);
    const inProgress = workspace().find((item) => item.appointmentId === "apt-now");
    expect(inProgress && deriveTreatmentPrimaryCta(inProgress).kind).toBe(
      "continue",
    );
    const incomplete = workspace().find((item) => item.appointmentId === "apt-done");
    expect(incomplete && deriveTreatmentPrimaryCta(incomplete).kind).toBe(
      "complete_record",
    );
    const done = workspace().find((item) => item.kind === "completed");
    expect(done && deriveTreatmentPrimaryCta(done).kind).toBe("view");
  });

  it("18. empty state next appointment", () => {
    const empty = deriveTreatmentEmptyState({
      visibleCount: 0,
      query: "",
      filter: "open",
      todayAppointments: [laterApt],
      now: NOW,
    });
    expect(empty).toEqual({
      kind: "next_appointment",
      startLabel: "14:00",
      customerName: "陳欣怡",
      serviceName: "窈窕曲線 SPA",
    });
    expect(
      deriveTreatmentEmptyState({
        visibleCount: 0,
        query: "",
        filter: "open",
        todayAppointments: [],
        now: NOW,
      })?.kind,
    ).toBe("all_clear");
  });

  it("19. mobile uses same selection state", () => {
    expect(isInlineTreatmentQuickViewViewport(1536)).toBe(true);
    expect(isInlineTreatmentQuickViewViewport(390)).toBe(false);
    expect(treatmentListPresentation(390)).toBe("mobile-cards");
    expect(treatmentListPresentation(820)).toBe("mobile-cards");
    expect(treatmentListPresentation(1536)).toBe("desktop-rows");
    expect(isTreatmentRowKeyboardActivation("Enter")).toBe(true);
    expect(isTreatmentRowKeyboardActivation(" ")).toBe(true);
    expect(isTreatmentRowKeyboardActivation("Tab")).toBe(false);
    const selected = resolveSelectedTreatment(
      workspace(),
      "draft:treatment-apt-now",
    );
    expect(shouldRenderTreatmentQuickView(selected)).toBe(true);
  });

  it("20. no treatment domain/store duplicated", () => {
    const derived = readFileSync(
      path.join(process.cwd(), "lib/treatments/treatment-workspace-derived.ts"),
      "utf8",
    );
    expect(derived).not.toMatch(/localStorage/);
    expect(derived).not.toMatch(/treatment-draft:/);
    expect(derived).not.toMatch(/treatments-completed/);
    expect(derived).toMatch(/listOpenTreatmentDrafts|TreatmentDraft/);
    const page = readFileSync(
      path.join(process.cwd(), "features/treatments/TreatmentsListPageClient.tsx"),
      "utf8",
    );
    const qv = readFileSync(
      path.join(process.cwd(), "features/treatments/TreatmentQuickView.tsx"),
      "utf8",
    );
    expect(page).toMatch(/listOpenTreatmentDrafts/);
    expect(page).toMatch(/listCompletedTreatmentsForOrganization/);
    expect(qv).toMatch(/resolveAppointmentCheckoutNav/);
    expect(page).not.toMatch(/createContext\(\s*\{[^}]*treatments/);
    expect(qv).not.toMatch(/localStorage/);
  });
});

describe("status + date filter edges", () => {
  it("derives relative in-progress and not-started from now", () => {
    expect(
      deriveTreatmentStatus({
        kind: "draft",
        appointmentStatus: "IN_SERVICE",
        startAt: inProgressApt.startAt,
        endAt: inProgressApt.endAt,
        recordIncomplete: true,
        now: NOW,
      }),
    ).toEqual({
      kind: "in_progress",
      title: "進行中",
      detail: "已進行 40 分鐘",
    });
    expect(
      deriveTreatmentStatus({
        kind: "appointment",
        appointmentStatus: "BOOKED",
        startAt: laterApt.startAt,
        endAt: laterApt.endAt,
        recordIncomplete: true,
        now: NOW,
      }).detail,
    ).toBe("還有 3 小時 20 分鐘");
  });

  it("date filter today hides yesterday completed", () => {
    const today = filterTreatmentItems(
      workspace(),
      "completed",
      "",
      "today",
      NOW,
    );
    expect(today.map((item) => item.appointmentId)).toEqual(["apt-today-done"]);
  });
});
