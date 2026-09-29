/**
 * Follow-up Workspace — presentation + existing store isolation.
 * Does not introduce a second Follow-up store.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { STATUS_LABEL } from "@/lib/appointments/domain";
import type { FollowUpTask } from "@/lib/follow-ups/domain";
import {
  FOLLOW_UPS_HAS_ACTIVITY_MODEL,
  FOLLOW_UPS_HAS_CONTACT_HISTORY,
  FOLLOW_UPS_HAS_CONTACTED_STATUS,
  FOLLOW_UPS_HAS_SECOND_STORE,
  FOLLOW_UPS_INLINE_MIN_PX,
  FOLLOW_UPS_PANEL_WIDTH_PX,
  FOLLOW_UPS_WORKSPACE_GAP_PX,
  buildFollowUpWorkspaceRows,
  countFollowUpWorkspaceSummary,
  filterFollowUpRows,
  followUpListPresentation,
  isFollowUpRowKeyboardActivation,
  isInlineFollowUpQuickViewViewport,
  followUpEmptyCopy,
  isTodayFollowUpEmptyState,
  listCompletedThisWeekFollowUps,
  listFollowUpsForTimeFilter,
  matchesFollowUpSearch,
  resolveSelectedFollowUpRow,
  shouldResetFollowUpSelection,
  type FollowUpAppointmentHint,
  type FollowUpCustomerHint,
  type FollowUpStaffHint,
  type FollowUpTreatmentHint,
  type FollowUpWorkspaceRow,
} from "@/lib/follow-ups/follow-ups-workspace-derived";
import {
  listDueTodayFollowUps,
  listOverdueFollowUps,
  listUpcomingFollowUps,
} from "@/lib/follow-ups/selectors";
import {
  completeFollowUpTask,
  ensureFollowUpTaskFromCompletedTreatment,
  snoozeFollowUpTask,
} from "@/lib/follow-ups/store";
import { createEmptyDraft } from "@/lib/treatment-draft";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { readFileSync } from "node:fs";
import path from "node:path";

beforeEach(() => {
  localStorage.clear();
});

const noon = new Date(2026, 8, 25, 12, 0, 0); // Fri Sep 25 2026 local

function task(
  partial: Partial<FollowUpTask> & { id: string; dueAt: string },
): FollowUpTask {
  return {
    organizationId: ORG_ENJOYE_ID,
    customerId: "demo-001",
    status: "OPEN",
    type: "TREATMENT_FOLLOW_UP",
    context: { followUpTags: [], customerName: "林小美" },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    assignedStaffId: "staff-001",
    ...partial,
  };
}

function customer(
  partial: Partial<FollowUpCustomerHint> & { id: string },
): FollowUpCustomerHint {
  return {
    organizationId: ORG_ENJOYE_ID,
    name: "林小美",
    phone: "0912-345-678",
    tags: [{ id: "vip", label: "VIP" }],
    ...partial,
  };
}

function staff(): FollowUpStaffHint[] {
  return [
    { userId: "staff-001", displayName: "怡蓁" },
    { userId: "staff-002", displayName: "小美" },
  ];
}

function rowsFrom(
  tasks: FollowUpTask[],
  extras?: {
    customers?: FollowUpCustomerHint[];
    treatments?: FollowUpTreatmentHint[];
    appointments?: FollowUpAppointmentHint[];
    organizationId?: string;
    now?: Date;
  },
): FollowUpWorkspaceRow[] {
  return buildFollowUpWorkspaceRows({
    tasks,
    organizationId: extras?.organizationId ?? ORG_ENJOYE_ID,
    customers: extras?.customers ?? [customer({ id: "demo-001" })],
    locations: [
      { id: LOC_ENJOYE_PRIMARY_ID, name: "主店" },
      { id: LOC_ENJOYE_SECONDARY_ID, name: "公益店" },
    ],
    staff: staff(),
    treatments: extras?.treatments,
    appointments: extras?.appointments,
    now: extras?.now ?? noon,
  });
}

describe("workspace layout constants", () => {
  it("uses 400px panel, 16px gap, 1200 breakpoint", () => {
    expect(FOLLOW_UPS_PANEL_WIDTH_PX).toBe(400);
    expect(FOLLOW_UPS_WORKSPACE_GAP_PX).toBe(16);
    expect(FOLLOW_UPS_INLINE_MIN_PX).toBe(1200);
    expect(isInlineFollowUpQuickViewViewport(1536)).toBe(true);
    expect(isInlineFollowUpQuickViewViewport(1200)).toBe(true);
    expect(isInlineFollowUpQuickViewViewport(1199)).toBe(false);
    expect(followUpListPresentation(1536)).toBe("desktop-rows");
    expect(followUpListPresentation(1024)).toBe("mobile-cards");
    expect(followUpListPresentation(390)).toBe("mobile-cards");
  });

  it("does not invent contact history / second store / extra statuses", () => {
    expect(FOLLOW_UPS_HAS_CONTACT_HISTORY).toBe(false);
    expect(FOLLOW_UPS_HAS_SECOND_STORE).toBe(false);
    expect(FOLLOW_UPS_HAS_ACTIVITY_MODEL).toBe(false);
    expect(FOLLOW_UPS_HAS_CONTACTED_STATUS).toBe(false);
  });

  it("activates rows with Enter / Space", () => {
    expect(isFollowUpRowKeyboardActivation("Enter")).toBe(true);
    expect(isFollowUpRowKeyboardActivation(" ")).toBe(true);
    expect(isFollowUpRowKeyboardActivation("Tab")).toBe(false);
  });
});

describe("summary derived from existing selectors", () => {
  const today = task({
    id: "fu-today",
    dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
  });
  const overdue = task({
    id: "fu-over",
    dueAt: new Date(2026, 8, 24, 9, 0, 0).toISOString(),
  });
  const upcoming = task({
    id: "fu-up",
    dueAt: new Date(2026, 8, 28, 10, 0, 0).toISOString(),
  });
  const doneThisWeek = task({
    id: "fu-done-week",
    dueAt: new Date(2026, 8, 22, 10, 0, 0).toISOString(),
    status: "COMPLETED",
    completedAt: new Date(2026, 8, 24, 15, 0, 0).toISOString(),
  });
  const doneLastWeek = task({
    id: "fu-done-old",
    dueAt: new Date(2026, 8, 10, 10, 0, 0).toISOString(),
    status: "COMPLETED",
    completedAt: new Date(2026, 8, 18, 15, 0, 0).toISOString(),
  });
  const doneNoStamp = task({
    id: "fu-done-nostamp",
    dueAt: new Date(2026, 8, 23, 10, 0, 0).toISOString(),
    status: "COMPLETED",
  });

  const all = [today, overdue, upcoming, doneThisWeek, doneLastWeek, doneNoStamp];

  it("derives today / overdue / upcoming from existing selectors", () => {
    const summary = countFollowUpWorkspaceSummary(all, noon);
    expect(summary.todayCount).toBe(listDueTodayFollowUps(all, noon).length);
    expect(summary.overdueCount).toBe(listOverdueFollowUps(all, noon).length);
    expect(summary.upcomingCount).toBe(listUpcomingFollowUps(all, noon).length);
    expect(summary.todayCount).toBe(1);
    expect(summary.overdueCount).toBe(1);
    expect(summary.upcomingCount).toBe(1);
  });

  it("counts this-week completed only when completedAt is in the Monday week", () => {
    const week = listCompletedThisWeekFollowUps(all, noon);
    expect(week.map((item) => item.id)).toEqual(["fu-done-week"]);
    expect(countFollowUpWorkspaceSummary(all, noon).completedThisWeekCount).toBe(1);
  });

  it("does not invent completedAt for week counts", () => {
    expect(
      listCompletedThisWeekFollowUps([doneNoStamp], noon),
    ).toHaveLength(0);
  });
});

describe("filters / search / sorting", () => {
  const today = task({
    id: "fu-today",
    customerId: "demo-001",
    dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
    note: "確認緊繃",
    type: "TREATMENT_FOLLOW_UP",
    assignedStaffId: "staff-001",
  });
  const overdue = task({
    id: "fu-over",
    customerId: "demo-002",
    dueAt: new Date(2026, 8, 20, 10, 0, 0).toISOString(),
    type: "REBOOKING",
    assignedStaffId: "staff-002",
    context: { followUpTags: ["右腋下"], customerName: "陳雅婷" },
  });
  const upcoming = task({
    id: "fu-up",
    customerId: "demo-001",
    dueAt: new Date(2026, 8, 30, 14, 0, 0).toISOString(),
    assignedStaffId: "staff-001",
  });
  const completed = task({
    id: "fu-done",
    customerId: "demo-001",
    dueAt: new Date(2026, 8, 22, 10, 0, 0).toISOString(),
    status: "COMPLETED",
    completedAt: new Date(2026, 8, 23, 11, 0, 0).toISOString(),
  });

  const customers = [
    customer({ id: "demo-001", name: "林小美", phone: "0912345678" }),
    customer({ id: "demo-002", name: "陳雅婷", phone: "0988-111-222" }),
  ];

  it("filters today / overdue / upcoming / completed / all", () => {
    const tasks = [today, overdue, upcoming, completed];
    expect(
      listFollowUpsForTimeFilter(tasks, "today", { now: noon }).map((item) => item.id),
    ).toEqual(["fu-today"]);
    expect(
      listFollowUpsForTimeFilter(tasks, "overdue", { now: noon }).map((item) => item.id),
    ).toEqual(["fu-over"]);
    expect(
      listFollowUpsForTimeFilter(tasks, "upcoming", { now: noon }).map((item) => item.id),
    ).toEqual(["fu-up"]);
    expect(
      listFollowUpsForTimeFilter(tasks, "completed", { now: noon }).map((item) => item.id),
    ).toEqual(["fu-done"]);
    expect(
      listFollowUpsForTimeFilter(tasks, "all", { now: noon }).map((item) => item.id),
    ).toEqual(["fu-over", "fu-done", "fu-today", "fu-up"]);
  });

  it("mine uses assignedStaffId, not staff name", () => {
    const tasks = [today, overdue, upcoming];
    expect(
      listFollowUpsForTimeFilter(tasks, "mine", {
        now: noon,
        staffId: "staff-001",
      }).map((item) => item.id),
    ).toEqual(["fu-today", "fu-up"]);
    expect(
      listFollowUpsForTimeFilter(tasks, "mine", {
        now: noon,
        staffId: "staff-002",
      }).map((item) => item.id),
    ).toEqual(["fu-over"]);
    expect(
      listFollowUpsForTimeFilter(tasks, "mine", { now: noon }).map((item) => item.id),
    ).toEqual([]);
  });

  it("searches customer name and phone via existing customer data", () => {
    const built = rowsFrom([today, overdue], { customers });
    expect(
      filterFollowUpRows(built, { type: "all", query: "林小" }).map((row) => row.taskId),
    ).toEqual(["fu-today"]);
    expect(
      filterFollowUpRows(built, { type: "all", query: "0988111222" }).map(
        (row) => row.taskId,
      ),
    ).toEqual(["fu-over"]);
    expect(
      filterFollowUpRows(built, { type: "all", query: "確認緊繃" }).map(
        (row) => row.taskId,
      ),
    ).toEqual(["fu-today"]);
  });

  it("filters by real type enum only", () => {
    const built = rowsFrom([today, overdue], { customers });
    expect(
      filterFollowUpRows(built, { type: "REBOOKING", query: "" }).map((row) => row.taskId),
    ).toEqual(["fu-over"]);
    expect(
      filterFollowUpRows(built, { type: "TREATMENT_FOLLOW_UP", query: "" }).map(
        (row) => row.taskId,
      ),
    ).toEqual(["fu-today"]);
  });

  it("sorts open rows by dueAt and completed by completedAt", () => {
    const laterToday = task({
      id: "fu-today-late",
      dueAt: new Date(2026, 8, 25, 16, 0, 0).toISOString(),
    });
    const ids = listFollowUpsForTimeFilter([laterToday, today], "today", {
      now: noon,
    }).map((item) => item.id);
    expect(ids).toEqual(["fu-today", "fu-today-late"]);
  });

  it("uses the same presentation model for desktop and mobile", () => {
    const [row] = rowsFrom([overdue], { customers });
    expect(row.customerName).toBe("陳雅婷");
    expect(row.customerPhone).toBe("0988-111-222");
    expect(row.overdueLabel).toBe("逾期 5 天");
    expect(row.typeLabel).toBe("再預約");
    expect(row.ownerLabel).toBe("小美");
    expect(followUpListPresentation(1440)).toBe("desktop-rows");
    expect(followUpListPresentation(430)).toBe("mobile-cards");
  });
});

describe("selection", () => {
  it("resolves and resets selectedFollowUpId", () => {
    const built = rowsFrom([
      task({
        id: "fu-a",
        dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
      }),
      task({
        id: "fu-b",
        customerId: "demo-002",
        dueAt: new Date(2026, 8, 24, 10, 0, 0).toISOString(),
      }),
    ]);
    expect(resolveSelectedFollowUpRow(built, "fu-a")?.taskId).toBe("fu-a");
    expect(resolveSelectedFollowUpRow(built, "missing")).toBeNull();
    expect(
      shouldResetFollowUpSelection({
        selectedFollowUpId: "fu-a",
        visibleRows: built.filter((row) => row.taskId === "fu-b"),
      }),
    ).toBe(true);
    expect(
      shouldResetFollowUpSelection({
        selectedFollowUpId: "fu-a",
        visibleRows: built,
      }),
    ).toBe(false);
    expect(
      shouldResetFollowUpSelection({
        selectedFollowUpId: null,
        visibleRows: built,
      }),
    ).toBe(false);
  });
});

describe("organization / location / staff isolation", () => {
  it("never maps another organization's tasks or customers", () => {
    const enjoye = task({
      id: "fu-enjoye",
      dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
      customerId: "demo-001",
    });
    const leak = task({
      id: "fu-lumiere",
      organizationId: ORG_LUMIERE_ID,
      customerId: "lumiere-guest",
      dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
    });
    const built = rowsFrom([enjoye, leak], {
      customers: [
        customer({ id: "demo-001", name: "林小美" }),
        customer({
          id: "lumiere-guest",
          organizationId: ORG_LUMIERE_ID,
          name: "他店客人",
          phone: "0900000000",
        }),
      ],
    });
    expect(built).toHaveLength(1);
    expect(built[0].taskId).toBe("fu-enjoye");
    expect(built[0].customerName).toBe("林小美");
    expect(built.some((row) => row.customerName === "他店客人")).toBe(false);
  });

  it("keeps org-wide CRM: same-org other location still visible", () => {
    const otherLoc = task({
      id: "fu-gongyi",
      locationId: LOC_ENJOYE_SECONDARY_ID,
      dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
    });
    const built = rowsFrom([otherLoc]);
    expect(built).toHaveLength(1);
    expect(built[0].locationName).toBe("公益店");
  });

  it("does not attach a same-id customer from another organization", () => {
    const enjoye = task({
      id: "fu-shared-id",
      customerId: "shared-cust",
      dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
      context: { followUpTags: [], customerName: "本店快照" },
    });
    const built = rowsFrom([enjoye], {
      customers: [
        customer({
          id: "shared-cust",
          organizationId: ORG_LUMIERE_ID,
          name: "他店同號",
          phone: "0911111111",
        }),
      ],
    });
    expect(built[0].customerName).toBe("本店快照");
    expect(built[0].customerPhone).toBe("");
  });

  it("shows related treatment / appointment only when the real id exists", () => {
    const withRelation = task({
      id: "fu-rel",
      treatmentId: "t-real",
      appointmentId: "apt-real",
      dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
      context: { followUpTags: [], serviceName: "胸部保養" },
    });
    const without = task({
      id: "fu-plain",
      dueAt: new Date(2026, 8, 25, 11, 0, 0).toISOString(),
    });
    const built = rowsFrom([withRelation, without], {
      treatments: [
        {
          id: "t-real",
          organizationId: ORG_ENJOYE_ID,
          serviceName: "胸部保養",
          dateIso: new Date(2026, 8, 18, 14, 0, 0).toISOString(),
          professionalNote: "右側較緊",
        },
        {
          id: "t-other",
          organizationId: ORG_ENJOYE_ID,
          serviceName: "不該冒充的最近療程",
          professionalNote: "假的",
        },
      ],
      appointments: [
        {
          id: "apt-real",
          organizationId: ORG_ENJOYE_ID,
          serviceName: "胸部保養",
          startAt: new Date(2026, 8, 18, 14, 0, 0).toISOString(),
          statusLabel: STATUS_LABEL.COMPLETED,
        },
      ],
    });
    expect(built[0].relatedTreatment?.professionalNote).toBe("右側較緊");
    expect(built[0].relatedAppointment?.appointmentId).toBe("apt-real");
    expect(built[1].relatedTreatment).toBeNull();
    expect(built[1].relatedAppointment).toBeNull();
    expect(built[1].relatedTreatment?.serviceName).not.toBe("不該冒充的最近療程");

    const sourceOnly = task({
      id: "fu-source",
      sourceTreatmentId: "t-real",
      dueAt: new Date(2026, 8, 25, 12, 0, 0).toISOString(),
      context: { followUpTags: [] },
    });
    const fromSource = rowsFrom([sourceOnly], {
      treatments: [
        {
          id: "t-real",
          organizationId: ORG_ENJOYE_ID,
          serviceName: "胸部保養",
          professionalNote: "右側較緊",
        },
      ],
    });
    expect(fromSource[0].relatedTreatment?.treatmentId).toBe("t-real");
    expect(fromSource[0].relatedTreatment?.professionalNote).toBe("右側較緊");
  });
});

describe("existing store transitions", () => {
  function completedTreatment(id: string) {
    const draft = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      appointmentId: `apt-${id}`,
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    draft.id = id;
    draft.status = "completed";
    draft.followUp = {
      tags: ["右腋下"],
      suggestedDate: "2026-09-25",
      note: "下次確認緊繃",
      suggestNextBooking: false,
    };
    return draft;
  }

  it("completes and snoozes through the canonical store", () => {
    const created = ensureFollowUpTaskFromCompletedTreatment(
      completedTreatment("t-ws-1"),
    )!;
    const done = completeFollowUpTask(ORG_ENJOYE_ID, created.id, {
      actorStaffId: "staff-001",
      completionNote: "已電話聯繫",
    });
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).toBeTruthy();

    const open = ensureFollowUpTaskFromCompletedTreatment(
      completedTreatment("t-ws-2"),
    )!;
    const nextDue = new Date(2026, 9, 2, 10, 0, 0).toISOString();
    const snoozed = snoozeFollowUpTask(ORG_ENJOYE_ID, open.id, {
      actorStaffId: "staff-001",
      dueAt: nextDue,
    });
    expect(snoozed.status).toBe("OPEN");
    expect(snoozed.dueAt).toBe(nextDue);
  });
});

describe("empty-state helper", () => {
  it("treats default today with no extra filters as today-empty", () => {
    expect(
      isTodayFollowUpEmptyState({
        timeFilter: "today",
        typeFilter: "all",
        query: "",
      }),
    ).toBe(true);
    expect(
      isTodayFollowUpEmptyState({
        timeFilter: "overdue",
        typeFilter: "all",
        query: "",
      }),
    ).toBe(false);
    expect(
      isTodayFollowUpEmptyState({
        timeFilter: "today",
        typeFilter: "REBOOKING",
        query: "",
      }),
    ).toBe(false);
    expect(
      followUpEmptyCopy({
        timeFilter: "overdue",
        typeFilter: "all",
        query: "",
      }).title,
    ).toBe("目前沒有逾期追蹤");
    expect(
      followUpEmptyCopy({
        timeFilter: "completed",
        typeFilter: "all",
        query: "",
      }).title,
    ).toBe("目前沒有已完成的追蹤");
    expect(
      followUpEmptyCopy({
        timeFilter: "today",
        typeFilter: "REBOOKING",
        query: "",
      }),
    ).toMatchObject({ kind: "filtered", showClear: true });
  });
});

describe("search helper stays on the row model", () => {
  it("does not match another customer's phone", () => {
    const [row] = rowsFrom([
      task({
        id: "fu-one",
        dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
      }),
    ]);
    expect(matchesFollowUpSearch(row, "0912345678")).toBe(true);
    expect(matchesFollowUpSearch(row, "0900000000")).toBe(false);
  });
});

describe("workspace wiring", () => {
  it("reuses StaffShell workbench width and existing follow-ups route", () => {
    const page = readFileSync(
      path.join(process.cwd(), "features/follow-ups/FollowUpsPageClient.tsx"),
      "utf8",
    );
    const quickView = readFileSync(
      path.join(process.cwd(), "features/follow-ups/FollowUpQuickView.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      path.join(process.cwd(), "components/layout/StaffShell.tsx"),
      "utf8",
    );
    const route = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/follow-ups/page.tsx"),
      "utf8",
    );
    expect(route).toMatch(/FollowUpsPageClient/);
    expect(page).toMatch(/data-followups-workspace/);
    expect(page).toMatch(/completeFollowUpTask/);
    expect(page).toMatch(/snoozeFollowUpTask/);
    expect(page).not.toMatch(/createFollowUpStore|followUpWorkspaceStore/);
    expect(quickView).toMatch(/role="dialog"/);
    expect(quickView).toMatch(/aria-modal="true"/);
    expect(quickView).toMatch(/data-followups-actions/);
    expect(quickView).toMatch(/data-followups-completed-state/);
    expect(quickView).toMatch(/完成追蹤/);
    expect(quickView).toMatch(/延後追蹤/);
    expect(quickView).toMatch(/再次預約/);
    expect(quickView).toMatch(/bottom-\[calc\(3\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
    expect(quickView).not.toMatch(/LINE 未讀|contactMethod|nextAction|SNOOZED/);
    expect(shell).toMatch(/isFollowUpsWorkbench/);
    expect(shell).toMatch(/w-\[232px\]/);
    expect(shell).toMatch(/w-\[254px\]/);
  });
});
