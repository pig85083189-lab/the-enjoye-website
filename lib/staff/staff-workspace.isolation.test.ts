import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { listMemberships } from "@/lib/tenant/organization-store";
import { getStaffAvailability } from "@/lib/staff-schedule/availability";
import {
  createBreak,
  createTimeOff,
  listBreaks,
  listTimeOff,
  listWorkingHours,
  upsertWorkingHours,
} from "@/lib/staff-schedule/store";
import type { StaffMembership } from "@/types/saas";
import type {
  StaffBreak,
  StaffTimeOff,
  StaffWorkingHours,
} from "@/lib/staff-schedule/domain";
import {
  STAFF_HAS_CALENDAR_STAFF_PREFILTER,
  STAFF_HAS_CREATE_FLOW,
  STAFF_HAS_SECOND_AVAILABILITY_CALCULATOR,
  STAFF_HAS_SECOND_SCHEDULE_STORE,
  STAFF_HAS_SERVICE_CAPABILITY_STORE,
  STAFF_HAS_SPLIT_SHIFTS,
  STAFF_WORKSPACE_GAP_PX,
  STAFF_WORKSPACE_PANEL_WIDTH_PX,
  buildStaffWorkspace,
  countStaffWorkspaceSummary,
  deriveStaffDayCell,
  filterStaffRows,
  formatStaffHoursValue,
  isStaffRowKeyboardActivation,
  listUpcomingTimeOff,
  matchesStaffSearch,
  planApplyWorkingHoursPattern,
  resolveSelectedStaffRow,
  staffListPresentation,
  staffOperatesLocation,
  staffWeekPresentation,
  startOfStaffWeek,
} from "./staff-workspace-derived";

beforeEach(() => {
  localStorage.clear();
});

const NOW = new Date(2026, 8, 29, 11, 0, 0); // Tuesday

function membership(over: Partial<StaffMembership> = {}): StaffMembership {
  return {
    id: over.id ?? "mem-a",
    organizationId: over.organizationId ?? ORG_ENJOYE_ID,
    userId: over.userId ?? "staff-alpha",
    locationIds: over.locationIds ?? [LOC_ENJOYE_PRIMARY_ID],
    role: over.role ?? "STAFF",
    displayName: over.displayName ?? "Alpha",
    isActive: over.isActive ?? true,
    createdAt: over.createdAt ?? "2026-01-01T00:00:00+08:00",
  };
}

function hours(over: Partial<StaffWorkingHours> = {}): StaffWorkingHours {
  return {
    id: over.id ?? `swh-${over.staffId ?? "staff-alpha"}-${over.dayOfWeek ?? 2}`,
    organizationId: over.organizationId ?? ORG_ENJOYE_ID,
    locationId: over.locationId ?? LOC_ENJOYE_PRIMARY_ID,
    staffId: over.staffId ?? "staff-alpha",
    dayOfWeek: over.dayOfWeek ?? 2,
    startTime: over.startTime ?? "09:00",
    endTime: over.endTime ?? "21:00",
    isWorking: over.isWorking ?? true,
    updatedAt: over.updatedAt ?? "2026-09-01T00:00:00.000Z",
  };
}

function weekHours(staffId: string, start = "09:00", end = "21:00"): StaffWorkingHours[] {
  return [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) =>
    hours({
      id: `swh-${staffId}-${dayOfWeek}`,
      staffId,
      dayOfWeek: dayOfWeek as StaffWorkingHours["dayOfWeek"],
      startTime: start,
      endTime: end,
      isWorking: dayOfWeek !== 0,
    }),
  );
}

function timeOff(over: Partial<StaffTimeOff> = {}): StaffTimeOff {
  return {
    id: over.id ?? "toff-1",
    organizationId: over.organizationId ?? ORG_ENJOYE_ID,
    locationId: over.locationId ?? LOC_ENJOYE_PRIMARY_ID,
    staffId: over.staffId ?? "staff-alpha",
    startAt: over.startAt ?? new Date(2026, 8, 29, 9, 0).toISOString(),
    endAt: over.endAt ?? new Date(2026, 8, 29, 21, 0).toISOString(),
    reason: over.reason,
    status: over.status ?? "APPROVED",
    createdAt: over.createdAt ?? "2026-09-01T00:00:00.000Z",
  };
}

function brk(over: Partial<StaffBreak> = {}): StaffBreak {
  return {
    id: over.id ?? "brk-1",
    organizationId: over.organizationId ?? ORG_ENJOYE_ID,
    locationId: over.locationId ?? LOC_ENJOYE_PRIMARY_ID,
    staffId: over.staffId ?? "staff-alpha",
    startAt: over.startAt ?? new Date(2026, 8, 29, 13, 0).toISOString(),
    endAt: over.endAt ?? new Date(2026, 8, 29, 14, 0).toISOString(),
    label: over.label ?? "午休",
    createdAt: over.createdAt ?? "2026-09-01T00:00:00.000Z",
  };
}

function model(over: {
  memberships?: StaffMembership[];
  workingHours?: StaffWorkingHours[];
  breaks?: StaffBreak[];
  timeOff?: StaffTimeOff[];
  locationId?: string;
  organizationId?: string;
} = {}) {
  return buildStaffWorkspace({
    organizationId: over.organizationId ?? ORG_ENJOYE_ID,
    locationId: over.locationId ?? LOC_ENJOYE_PRIMARY_ID,
    locationName: "THE ENJOYE 主店",
    memberships: over.memberships ?? [
      membership(),
      membership({
        id: "mem-b",
        userId: "staff-beta",
        displayName: "Beta",
        role: "OWNER",
        createdAt: "2026-01-02T00:00:00+08:00",
      }),
    ],
    workingHours: over.workingHours ?? [
      ...weekHours("staff-alpha"),
      ...weekHours("staff-beta", "10:00", "19:00"),
    ],
    breaks: over.breaks ?? [],
    timeOff: over.timeOff ?? [],
    now: NOW,
  });
}

describe("A–E summary derived", () => {
  it("A/B counts active staff and inactive separately", () => {
    const built = model({
      memberships: [
        membership({ isActive: true }),
        membership({
          id: "mem-off",
          userId: "staff-off",
          displayName: "Off",
          isActive: false,
        }),
      ],
      workingHours: [...weekHours("staff-alpha"), ...weekHours("staff-off")],
    });
    expect(built.summary.activeCount).toBe(1);
    expect(built.summary.inactiveCount).toBe(1);
    expect(countStaffWorkspaceSummary(built.rows, built.weekGrid).activeCount).toBe(1);
  });

  it("C counts today working from canonical hours, not names", () => {
    const built = model();
    expect(built.summary.todayWorkingCount).toBe(2);
    expect(built.rows.every((row) => row.todayStatus === "working")).toBe(true);
  });

  it("D counts today approved time off and excludes that person from working", () => {
    const built = model({
      timeOff: [timeOff({ staffId: "staff-alpha" })],
    });
    expect(built.summary.todayTimeOffCount).toBe(1);
    expect(built.summary.todayWorkingCount).toBe(1);
    const alpha = built.rows.find((row) => row.staffId === "staff-alpha");
    expect(alpha?.todayStatus).toBe("time_off");
    expect(alpha?.todayHoursLabel).toBe("今日休假");
  });

  it("E weekly hours sum working minutes minus overlapping approved time off", () => {
    const built = model({
      memberships: [membership()],
      workingHours: weekHours("staff-alpha"),
    });
    // Mon–Sat 12h = 72h
    expect(built.summary.weeklyScheduledMinutes).toBe(6 * 12 * 60);
    expect(formatStaffHoursValue(built.summary.weeklyScheduledMinutes)).toBe("72h");
    expect(formatStaffHoursValue(built.summary.weeklyAverageMinutes)).toBe("72h");

    const withOff = model({
      memberships: [membership()],
      workingHours: weekHours("staff-alpha"),
      timeOff: [timeOff({ staffId: "staff-alpha" })],
    });
    expect(withOff.summary.weeklyScheduledMinutes).toBe(5 * 12 * 60);
  });
});

describe("F–H isolation keys", () => {
  it("F org A memberships do not appear in org B workspace", () => {
    const built = model({
      organizationId: ORG_LUMIERE_ID,
      locationId: LOC_LUMIERE_PRIMARY_ID,
      memberships: [
        membership({ organizationId: ORG_ENJOYE_ID, userId: "staff-001" }),
        membership({
          organizationId: ORG_LUMIERE_ID,
          userId: "staff-001",
          displayName: "語柔分身",
          locationIds: [LOC_LUMIERE_PRIMARY_ID],
        }),
      ],
      workingHours: weekHours("staff-001").map((item) => ({
        ...item,
        organizationId: ORG_LUMIERE_ID,
        locationId: LOC_LUMIERE_PRIMARY_ID,
      })),
    });
    expect(built.rows).toHaveLength(1);
    expect(built.rows[0]?.organizationId).toBe(ORG_LUMIERE_ID);
    expect(built.rows[0]?.displayName).toBe("語柔分身");
  });

  it("G location-aware hours stay on the requested location", () => {
    const built = model({
      locationId: LOC_ENJOYE_SECONDARY_ID,
      memberships: [
        membership({
          locationIds: [LOC_ENJOYE_PRIMARY_ID, LOC_ENJOYE_SECONDARY_ID],
        }),
      ],
      workingHours: [
        ...weekHours("staff-alpha").map((item) => ({
          ...item,
          locationId: LOC_ENJOYE_PRIMARY_ID,
          startTime: "09:00",
        })),
        ...weekHours("staff-alpha").map((item) => ({
          ...item,
          id: `${item.id}-gongyi`,
          locationId: LOC_ENJOYE_SECONDARY_ID,
          startTime: "11:00",
          endTime: "18:00",
        })),
      ],
    });
    const today = built.weekGrid[0]?.cells.find((cell) => cell.ymd === "2026-09-29");
    expect(today?.compactLabel).toBe("11–18");
    expect(
      staffOperatesLocation(
        membership({ locationIds: [LOC_ENJOYE_PRIMARY_ID] }),
        LOC_ENJOYE_SECONDARY_ID,
      ),
    ).toBe(false);
  });

  it("H joins schedule by staffId, never displayName", () => {
    const built = model({
      memberships: [
        membership({ userId: "staff-alpha", displayName: "小美" }),
        membership({
          id: "mem-imposter",
          userId: "staff-other",
          displayName: "小美",
          createdAt: "2026-02-01T00:00:00+08:00",
        }),
      ],
      workingHours: [
        ...weekHours("staff-alpha", "09:00", "12:00"),
        ...weekHours("staff-other", "15:00", "21:00"),
      ],
      timeOff: [timeOff({ staffId: "staff-alpha" })],
    });
    const byName = built.rows.filter((row) => row.displayName === "小美");
    expect(byName).toHaveLength(2);
    expect(byName.find((row) => row.staffId === "staff-alpha")?.todayStatus).toBe(
      "time_off",
    );
    expect(byName.find((row) => row.staffId === "staff-other")?.todayStatus).toBe(
      "working",
    );
  });
});

describe("I–L schedule presentation", () => {
  it("I working hours cells keep start/end from the canonical row", () => {
    const cell = deriveStaffDayCell({
      staffId: "staff-alpha",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      day: NOW,
      workingHours: [hours({ startTime: "10:00", endTime: "19:00" })],
      timeOff: [],
    });
    expect(cell.kind).toBe("working");
    expect(cell.compactLabel).toBe("10–19");
    expect(cell.scheduledMinutes).toBe(9 * 60);
  });

  it("J breaks do not rewrite weekly scheduled hours", () => {
    const built = model({
      memberships: [membership()],
      workingHours: weekHours("staff-alpha"),
      breaks: [brk()],
    });
    expect(built.summary.weeklyScheduledMinutes).toBe(6 * 12 * 60);
    expect(built.rows[0]?.todayBreaks[0]?.rangeLabel).toBe("13:00–14:00");
  });

  it("K requested time off is listed but does not mark today as 休假", () => {
    const built = model({
      memberships: [membership()],
      workingHours: weekHours("staff-alpha"),
      timeOff: [timeOff({ status: "REQUESTED" })],
    });
    expect(built.rows[0]?.todayStatus).toBe("working");
    const upcoming = listUpcomingTimeOff({
      timeOff: [timeOff({ status: "REQUESTED" })],
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-alpha",
      now: NOW,
    });
    expect(upcoming[0]?.status).toBe("REQUESTED");
  });

  it("L split remaining windows stay unmerged when domain has one hours row + partial time off", () => {
    expect(STAFF_HAS_SPLIT_SHIFTS).toBe(false);
    const cell = deriveStaffDayCell({
      staffId: "staff-alpha",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      day: NOW,
      workingHours: [hours()],
      timeOff: [
        timeOff({
          startAt: new Date(2026, 8, 29, 12, 0).toISOString(),
          endAt: new Date(2026, 8, 29, 14, 0).toISOString(),
        }),
      ],
    });
    expect(cell.kind).toBe("mixed");
    expect(cell.compactLabel).toBe("9–12 / 14–21");
    expect(cell.segments.filter((segment) => segment.kind === "working")).toHaveLength(2);
  });
});

describe("M–Q workspace chrome", () => {
  it("M does not invent a capability store", () => {
    expect(STAFF_HAS_SERVICE_CAPABILITY_STORE).toBe(false);
    expect(STAFF_HAS_CREATE_FLOW).toBe(false);
    expect(STAFF_HAS_CALENDAR_STAFF_PREFILTER).toBe(false);
  });

  it("N resolves selected staff by staffId", () => {
    const built = model();
    expect(resolveSelectedStaffRow(built.rows, "staff-beta")?.displayName).toBe("Beta");
    expect(resolveSelectedStaffRow(built.rows, "missing")).toBeNull();
  });

  it("O filters active / inactive without inventing extra statuses", () => {
    const built = model({
      memberships: [
        membership({ isActive: true }),
        membership({
          id: "mem-off",
          userId: "staff-off",
          displayName: "停用者",
          isActive: false,
        }),
      ],
      workingHours: weekHours("staff-alpha"),
    });
    expect(filterStaffRows(built.rows, "active", "")).toHaveLength(1);
    expect(filterStaffRows(built.rows, "inactive", "")[0]?.staffId).toBe("staff-off");
    expect(filterStaffRows(built.rows, "all", "")).toHaveLength(2);
  });

  it("P search uses displayName and role only", () => {
    const built = model();
    expect(matchesStaffSearch(built.rows[0]!, "alpha")).toBe(true);
    expect(matchesStaffSearch(built.rows[1]!, "owner")).toBe(true);
    expect(matchesStaffSearch(built.rows[0]!, "0912")).toBe(false);
  });

  it("Q keyboard activation is Enter / Space", () => {
    expect(isStaffRowKeyboardActivation("Enter")).toBe(true);
    expect(isStaffRowKeyboardActivation(" ")).toBe(true);
    expect(isStaffRowKeyboardActivation("Tab")).toBe(false);
  });
});

describe("R–T presentation + calendar contract", () => {
  it("R mobile presentation switches below 1200", () => {
    expect(staffListPresentation(1536)).toBe("desktop-rows");
    expect(staffListPresentation(430)).toBe("mobile-cards");
    expect(staffWeekPresentation(390)).toBe("mobile-day");
    expect(STAFF_WORKSPACE_PANEL_WIDTH_PX).toBe(400);
    expect(STAFF_WORKSPACE_GAP_PX).toBe(16);
  });

  it("S workspace mutations keep using Calendar getStaffAvailability", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      dayOfWeek: 2,
      startTime: "09:00",
      endTime: "21:00",
      isWorking: true,
    });
    const slot = {
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      startAt: new Date(2026, 8, 29, 14, 0).toISOString(),
      endAt: new Date(2026, 8, 29, 15, 0).toISOString(),
      appointments: [],
    };
    expect(getStaffAvailability(slot).available).toBe(true);
    createBreak(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      startAt: slot.startAt,
      endAt: slot.endAt,
      label: "午休",
    });
    expect(getStaffAvailability(slot).reasons).toContain("BREAK");
    createTimeOff(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      startAt: new Date(2026, 8, 29, 9, 0).toISOString(),
      endAt: new Date(2026, 8, 29, 21, 0).toISOString(),
      reason: "休假",
    });
    expect(getStaffAvailability(slot).reasons).toContain("TIME_OFF");
  });

  it("T does not add a second schedule calculator or store", () => {
    expect(STAFF_HAS_SECOND_SCHEDULE_STORE).toBe(false);
    expect(STAFF_HAS_SECOND_AVAILABILITY_CALCULATOR).toBe(false);
    const derived = readFileSync(
      path.join(process.cwd(), "lib/staff/staff-workspace-derived.ts"),
      "utf8",
    );
    const page = readFileSync(
      path.join(process.cwd(), "features/staff/StaffWorkspacePage.tsx"),
      "utf8",
    );
    const quickView = readFileSync(
      path.join(process.cwd(), "features/staff/StaffQuickView.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      path.join(process.cwd(), "components/layout/StaffShell.tsx"),
      "utf8",
    );
    const route = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/staff/page.tsx"),
      "utf8",
    );
    expect(derived).not.toMatch(/getStaffAvailability|findAvailableStaff/);
    expect(derived).not.toMatch(/localStorage|staffWorkspaceStore|scheduleStoreV2/);
    expect(page).toMatch(/upsertWorkingHours|createBreak|createTimeOff/);
    expect(page).not.toMatch(/createStaffStore|staffWorkspaceStore/);
    expect(quickView).toMatch(/role="dialog"/);
    expect(quickView).toMatch(/aria-modal="true"/);
    expect(quickView).toMatch(/bottom-\[calc\(3\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
    expect(quickView).not.toMatch(/可服務項目|美胸 SPA|查看預約/);
    expect(route).toMatch(/StaffWorkspacePage/);
    expect(shell).toMatch(/isStaffWorkbench/);
    expect(shell).toMatch(/w-\[232px\]/);
    expect(shell).toMatch(/w-\[254px\]/);
  });
});

describe("apply hours helper and canonical list", () => {
  it("apply Mon–Fri only plans existing upsert payloads", () => {
    const drafts = planApplyWorkingHoursPattern({
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-alpha",
      hours: weekHours("staff-alpha", "10:00", "18:00"),
      pattern: "mon-fri",
    });
    expect(drafts.map((item) => item.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
    expect(drafts.every((item) => item.startTime === "10:00")).toBe(true);
  });

  it("listMemberships stays org-scoped and includes inactive", () => {
    const enjoye = listMemberships(ORG_ENJOYE_ID);
    const lumiere = listMemberships(ORG_LUMIERE_ID);
    expect(enjoye.every((item) => item.organizationId === ORG_ENJOYE_ID)).toBe(true);
    expect(lumiere.some((item) => item.userId === "staff-002")).toBe(false);
    expect(enjoye.some((item) => item.userId === "staff-lumiere-01")).toBe(false);
  });

  it("week starts Monday containing the given now", () => {
    const monday = startOfStaffWeek(NOW);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(28);
  });
});

describe("store still owns persistence", () => {
  it("apply helper + upsertWorkingHours writes the canonical key", () => {
    const drafts = planApplyWorkingHoursPattern({
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      hours: [],
      pattern: "mon-sat",
    });
    for (const draft of drafts) {
      upsertWorkingHours(ORG_ENJOYE_ID, draft);
    }
    const saved = listWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
    });
    expect(saved.filter((item) => item.isWorking).map((item) => item.dayOfWeek).sort()).toEqual(
      [1, 2, 3, 4, 5, 6],
    );
  });

  it("breaks and time off remain readable from the existing store", () => {
    createBreak(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      startAt: new Date(2026, 8, 29, 13, 0).toISOString(),
      endAt: new Date(2026, 8, 29, 14, 0).toISOString(),
      label: "午休",
    });
    createTimeOff(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      startAt: new Date(2026, 8, 30, 9, 0).toISOString(),
      endAt: new Date(2026, 8, 30, 21, 0).toISOString(),
    });
    expect(
      listBreaks(ORG_ENJOYE_ID, {
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: "staff-002",
      }),
    ).toHaveLength(1);
    expect(
      listTimeOff(ORG_ENJOYE_ID, {
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: "staff-002",
      }),
    ).toHaveLength(1);
  });
});
