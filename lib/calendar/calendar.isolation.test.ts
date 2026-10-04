import { beforeEach, describe, expect, it } from "vitest";
import {
  CALENDAR_SLOT_MINUTES,
  CALENDAR_SLOT_PX,
} from "@/lib/appointments/calendar-config";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  clampScrollTop,
  formatNowHm,
  nowLineTopPx,
  resolveDayViewScrollTop,
  scrollOffsetForNow,
  shouldShowNowLine,
} from "@/lib/calendar/now-line";
import {
  formatStaffDayHeaderMeta,
  resolveStaffDayScheduleStatus,
} from "@/lib/calendar/schedule-status";
import {
  buildStaffWorkloadRows,
  computeStaffWorkload,
  computeTotalWorkload,
  formatWorkloadHours,
  minutesToGridTopPx,
} from "@/lib/calendar/workload";
import {
  LOC_ENJOYE_PRIMARY_ID,
  ORG_ENJOYE_ID,
} from "@/lib/tenant/constants";
import {
  createBreak,
  createTimeOff,
  getWorkingHoursForDay,
  listBreaks,
  upsertWorkingHours,
} from "@/lib/staff-schedule/store";
import { dayOfWeekLocal } from "@/lib/staff-schedule/domain";
import {
  applyCalendarVisualFixture,
  CALENDAR_VISUAL_FIXTURE_DAY,
  CALENDAR_VISUAL_FIXTURE_NOW,
} from "@/lib/calendar/visual-fixture";
import {
  CALENDAR_INLINE_QUICKVIEW_MIN_PX,
  QUICK_VIEW_WIDTH_PX,
  serviceTypeCardTone,
} from "@/features/calendar/grid-shared";
import {
  isAppointmentKeyboardActivation,
  isInlineQuickViewViewport,
  resolveSelectedAppointment,
  shouldRenderQuickView,
  shouldResetCalendarSelection,
} from "@/lib/calendar/selection";
import type { StaffMembership } from "@/types/saas";

const DAY_START = 9 * 60;
const DAY_END = 21 * 60;

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

function apt(
  partial: Partial<ScheduleAppointment> &
    Pick<
      ScheduleAppointment,
      | "id"
      | "staffId"
      | "startAt"
      | "endAt"
      | "durationMinutes"
      | "status"
    >,
): ScheduleAppointment {
  return {
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "c1",
    customerName: "客",
    serviceId: "svc",
    serviceName: "SPA",
    staffName: "怡蓁",
    notes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const sunday = new Date(2026, 8, 27); // 2026-09-27 Sunday
const monday = new Date(2026, 8, 21);

describe("resolveStaffDayScheduleStatus", () => {
  it("shows working hours when isWorking", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      dayOfWeek: 0,
      startTime: "10:00",
      endTime: "19:00",
      isWorking: true,
    });
    const status = resolveStaffDayScheduleStatus({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      day: sunday,
      now: new Date(2026, 8, 27, 12, 0),
    });
    expect(status.kind).toBe("working");
    expect(status.workingLabel).toBe("10:00 – 19:00");
    expect(status.dutyLabel).toBe("上班中");
    expect(status.isOnLeave).toBe(false);
    expect(formatStaffDayHeaderMeta(status)).toBe("10:00 – 19:00");
  });

  it("shows 未排班 when isWorking:false (not 休假)", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      dayOfWeek: 0,
      startTime: "10:00",
      endTime: "19:00",
      isWorking: false,
    });
    const status = resolveStaffDayScheduleStatus({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      day: sunday,
    });
    expect(status.kind).toBe("not_scheduled");
    expect(status.isOnLeave).toBe(false);
    expect(status.isNotScheduled).toBe(true);
    expect(formatStaffDayHeaderMeta(status)).toBe("未排班");
  });

  it("shows 休假 only for APPROVED time off", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      dayOfWeek: 0,
      startTime: "10:00",
      endTime: "19:00",
      isWorking: true,
    });
    createTimeOff(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      startAt: new Date(2026, 8, 27, 0, 0).toISOString(),
      endAt: new Date(2026, 8, 28, 0, 0).toISOString(),
      status: "APPROVED",
      reason: "個人假期",
    });
    const status = resolveStaffDayScheduleStatus({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      day: sunday,
    });
    expect(status.kind).toBe("time_off");
    expect(status.isOnLeave).toBe(true);
    expect(formatStaffDayHeaderMeta(status)).toBe("休假");
  });

  it("keeps 未排班 + appointment conflict hint without inventing leave", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      dayOfWeek: 0,
      startTime: "10:00",
      endTime: "19:00",
      isWorking: false,
    });
    const status = resolveStaffDayScheduleStatus({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      day: sunday,
    });
    expect(status.kind).toBe("not_scheduled");
    expect(formatStaffDayHeaderMeta(status, 3)).toBe("未排班 · 3 筆預約");
  });

  it("does not treat break as time off", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-003",
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "19:00",
      isWorking: true,
    });
    createBreak(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-003",
      startAt: new Date(2026, 8, 21, 12, 0).toISOString(),
      endAt: new Date(2026, 8, 21, 13, 0).toISOString(),
      label: "午休",
    });
    const status = resolveStaffDayScheduleStatus({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-003",
      day: monday,
      now: new Date(2026, 8, 21, 9, 0),
    });
    expect(status.kind).toBe("working");
    expect(status.isOnLeave).toBe(false);
    expect(status.dutyLabel).toBe("今日有班");
  });

  it("marks 已下班 after end time", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      dayOfWeek: 0,
      startTime: "10:00",
      endTime: "19:00",
      isWorking: true,
    });
    const status = resolveStaffDayScheduleStatus({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      day: sunday,
      now: new Date(2026, 8, 27, 20, 0),
    });
    expect(status.dutyLabel).toBe("已下班");
  });

  it("falls back to location default hours when a remote staff has no personal schedule", () => {
    const status = resolveStaffDayScheduleStatus({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      day: new Date(2026, 9, 4),
    });
    expect(status.kind).toBe("working");
    expect(status.workingLabel).toBe("09:00 – 21:00");
    expect(status.isNotScheduled).toBe(false);
    expect(status.isNonWorkingDay).toBe(false);
    expect(formatStaffDayHeaderMeta(status)).toBe("09:00 – 21:00");
  });
});

describe("computeStaffWorkload", () => {
  const day = new Date(2026, 8, 27);
  const appts: ScheduleAppointment[] = [
    apt({
      id: "a1",
      staffId: "s1",
      startAt: new Date(2026, 8, 27, 10, 0).toISOString(),
      endAt: new Date(2026, 8, 27, 11, 40).toISOString(),
      durationMinutes: 100,
      status: "BOOKED",
    }),
    apt({
      id: "a2",
      staffId: "s1",
      startAt: new Date(2026, 8, 27, 14, 0).toISOString(),
      endAt: new Date(2026, 8, 27, 15, 0).toISOString(),
      durationMinutes: 60,
      status: "COMPLETED",
    }),
    apt({
      id: "a3",
      staffId: "s1",
      startAt: new Date(2026, 8, 27, 16, 0).toISOString(),
      endAt: new Date(2026, 8, 27, 17, 0).toISOString(),
      durationMinutes: 60,
      status: "CANCELLED",
    }),
    apt({
      id: "a4",
      staffId: "s2",
      startAt: new Date(2026, 8, 27, 11, 0).toISOString(),
      endAt: new Date(2026, 8, 27, 12, 0).toISOString(),
      durationMinutes: 60,
      status: "BOOKED",
    }),
  ];

  it("sums active appointments for one staff on a day", () => {
    const load = computeStaffWorkload({
      staffId: "s1",
      appointments: appts,
      from: day,
      toInclusive: day,
    });
    expect(load.count).toBe(2);
    expect(load.hours).toBe(2.7);
  });

  it("excludes cancelled from workload", () => {
    const load = computeStaffWorkload({
      staffId: "s1",
      appointments: appts,
      from: day,
      toInclusive: day,
    });
    expect(load.count).not.toBe(3);
  });

  it("computes total across staff", () => {
    const total = computeTotalWorkload(appts, day, day);
    expect(total.count).toBe(3);
    expect(total.hours).toBe(3.7);
  });

  it("workload ignores working-hours / not_scheduled", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      dayOfWeek: 0,
      startTime: "10:00",
      endTime: "19:00",
      isWorking: false,
    });
    const staff: StaffMembership[] = [
      {
        id: "m1",
        organizationId: ORG_ENJOYE_ID,
        userId: "staff-001",
        locationIds: [LOC_ENJOYE_PRIMARY_ID],
        role: "STAFF",
        displayName: "怡蓁",
        isActive: true,
        createdAt: "2025-01-01T00:00:00+08:00",
      },
    ];
    const rows = buildStaffWorkloadRows({
      staff,
      appointments: [
        apt({
          id: "w1",
          staffId: "staff-001",
          startAt: new Date(2026, 8, 27, 14, 0).toISOString(),
          endAt: new Date(2026, 8, 27, 16, 0).toISOString(),
          durationMinutes: 120,
          status: "BOOKED",
        }),
        apt({
          id: "w2",
          staffId: "staff-001",
          startAt: new Date(2026, 8, 27, 16, 0).toISOString(),
          endAt: new Date(2026, 8, 27, 18, 0).toISOString(),
          durationMinutes: 120,
          status: "CONFIRMED",
        }),
        apt({
          id: "w3",
          staffId: "staff-001",
          startAt: new Date(2026, 8, 27, 18, 0).toISOString(),
          endAt: new Date(2026, 8, 27, 20, 0).toISOString(),
          durationMinutes: 120,
          status: "BOOKED",
        }),
      ],
      from: sunday,
      toInclusive: sunday,
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      scheduleDay: sunday,
    });
    expect(rows[0].scheduleKind).toBe("not_scheduled");
    expect(rows[0].count).toBe(3);
    expect(rows[0].hours).toBe(6);
  });
});

describe("now line + day view scroll", () => {
  it("only shows on the same local day", () => {
    const today = new Date(2026, 8, 27, 13, 24);
    const other = new Date(2026, 8, 28, 13, 24);
    expect(shouldShowNowLine(today, today)).toBe(true);
    expect(shouldShowNowLine(other, today)).toBe(false);
    expect(shouldShowNowLine(today, null)).toBe(false);
  });

  it("places now line inside visible range", () => {
    const now = new Date(2026, 8, 27, 13, 24);
    const top = nowLineTopPx({
      now,
      visibleStartMinutes: DAY_START,
      visibleEndMinutes: DAY_END,
      slotMinutes: CALENDAR_SLOT_MINUTES,
      slotPx: CALENDAR_SLOT_PX,
    });
    expect(top).not.toBeNull();
    expect(top!).toBeGreaterThan(0);
    expect(formatNowHm(now)).toBe("13:24");
  });

  it("hides now line outside visible window", () => {
    const now = new Date(2026, 8, 27, 7, 0);
    const top = nowLineTopPx({
      now,
      visibleStartMinutes: DAY_START,
      visibleEndMinutes: DAY_END,
      slotMinutes: CALENDAR_SLOT_MINUTES,
      slotPx: CALENDAR_SLOT_PX,
    });
    expect(top).toBeNull();
  });

  it("legacy scrollOffsetForNow still works", () => {
    const now = new Date(2026, 8, 27, 13, 24);
    const offset = scrollOffsetForNow({
      now,
      visibleStartMinutes: DAY_START,
      slotMinutes: CALENDAR_SLOT_MINUTES,
      slotPx: CALENDAR_SLOT_PX,
      paddingAbovePx: 120,
    });
    const rawTop = minutesToGridTopPx(
      13 * 60 + 24,
      DAY_START,
      CALENDAR_SLOT_MINUTES,
      CALENDAR_SLOT_PX,
    );
    expect(offset).toBe(Math.max(0, rawTop - 120));
  });

  it("clamps scroll target within range", () => {
    expect(clampScrollTop(-20, 400)).toBe(0);
    expect(clampScrollTop(500, 400)).toBe(400);
    expect(clampScrollTop(120, 400)).toBe(120);
    expect(clampScrollTop(10, 0)).toBe(0);
  });

  it("initial scroll does not hide relevant appointment under sticky header", () => {
    const now = new Date(2026, 8, 27, 14, 20);
    const stickyHeaderPx = 104;
    const viewportPx = 600;
    const aptStart = 14 * 60; // 14:00 in progress
    const scrollTop = resolveDayViewScrollTop({
      now,
      isToday: true,
      appointmentStartMinutes: [aptStart, 16 * 60, 18 * 60],
      visibleStartMinutes: DAY_START,
      visibleEndMinutes: DAY_END,
      slotMinutes: CALENDAR_SLOT_MINUTES,
      slotPx: CALENDAR_SLOT_PX,
      stickyHeaderPx,
      viewportPx,
      contextBufferMinutes: 45,
    });
    const aptTop = minutesToGridTopPx(
      aptStart,
      DAY_START,
      CALENDAR_SLOT_MINUTES,
      CALENDAR_SLOT_PX,
    );
    // Appointment top must remain below sticky header after scrolling
    expect(aptTop - scrollTop).toBeGreaterThanOrEqual(stickyHeaderPx);
  });

  it("scroll target is clamped to grid bounds", () => {
    const now = new Date(2026, 8, 27, 20, 45);
    const stickyHeaderPx = 104;
    const viewportPx = 500;
    const gridHeight =
      ((DAY_END - DAY_START) / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_PX;
    const maxScroll = Math.max(0, gridHeight - viewportPx);
    const scrollTop = resolveDayViewScrollTop({
      now,
      isToday: true,
      appointmentStartMinutes: [],
      visibleStartMinutes: DAY_START,
      visibleEndMinutes: DAY_END,
      slotMinutes: CALENDAR_SLOT_MINUTES,
      slotPx: CALENDAR_SLOT_PX,
      stickyHeaderPx,
      viewportPx,
    });
    expect(scrollTop).toBeGreaterThanOrEqual(0);
    expect(scrollTop).toBeLessThanOrEqual(maxScroll);
  });
});

describe("day-view visual tokens", () => {
  it("keeps the measured 30px / 30-minute slot from the desktop reference", () => {
    expect(CALENDAR_SLOT_PX).toBe(30);
  });
});

describe("serviceTypeCardTone", () => {
  it("maps existing service types to stable rose / sage / lavender tints", () => {
    expect(serviceTypeCardTone("BREAST")).toEqual({
      bg: "bg-[#F8ECEB]",
      accent: "bg-[#C9797D]",
    });
    expect(serviceTypeCardTone("BODY_SCULPTING")).toEqual({
      bg: "bg-[#EAF3EE]",
      accent: "bg-[#6A8F74]",
    });
    expect(serviceTypeCardTone("FACIAL")).toEqual({
      bg: "bg-[#EEEAF8]",
      accent: "bg-[#8B7AA8]",
    });
  });

  it("does not invent tints for unmapped types or staff identity", () => {
    expect(serviceTypeCardTone("WOMB_CARE")).toBeNull();
    expect(serviceTypeCardTone("GENERIC")).toBeNull();
    expect(serviceTypeCardTone("ACID_DRAIN")).toBeNull();
    expect(serviceTypeCardTone(undefined)).toBeNull();
    expect(serviceTypeCardTone("staff-001")).toBeNull();
  });
});

describe("calendar visual fixture (test-only)", () => {
  const staffIds = ["staff-001", "staff-002", "staff-003", "staff-004"] as [
    string,
    string,
    string,
    string,
  ];

  beforeEach(() => {
    applyCalendarVisualFixture({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffIds,
    });
  });

  it("applies working hours, break, and approved time off without touching production seed", () => {
    const dow = dayOfWeekLocal(CALENDAR_VISUAL_FIXTURE_DAY);
    const hoursA = getWorkingHoursForDay(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      "staff-001",
      dow,
    );
    const hoursB = getWorkingHoursForDay(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      "staff-002",
      dow,
    );
    const hoursC = getWorkingHoursForDay(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      "staff-003",
      dow,
    );

    expect(hoursA).toMatchObject({
      startTime: "10:00",
      endTime: "19:00",
      isWorking: true,
    });
    expect(hoursB).toMatchObject({
      startTime: "10:00",
      endTime: "19:00",
      isWorking: true,
    });
    expect(hoursC).toMatchObject({
      startTime: "11:00",
      endTime: "20:00",
      isWorking: true,
    });

    const breaksB = listBreaks(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-002",
      from: new Date(2026, 8, 27, 0, 0),
      to: new Date(2026, 8, 28, 0, 0),
    });
    expect(breaksB).toHaveLength(1);
    expect(new Date(breaksB[0].startAt).getHours()).toBe(12);
    expect(new Date(breaksB[0].endAt).getHours()).toBe(13);

    const staffA = resolveStaffDayScheduleStatus({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      day: CALENDAR_VISUAL_FIXTURE_DAY,
      now: CALENDAR_VISUAL_FIXTURE_NOW,
    });
    const staffD = resolveStaffDayScheduleStatus({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-004",
      day: CALENDAR_VISUAL_FIXTURE_DAY,
      now: CALENDAR_VISUAL_FIXTURE_NOW,
    });

    expect(staffA.kind).toBe("working");
    expect(staffA.workingLabel).toBe("10:00 – 19:00");
    expect(staffA.dutyLabel).toBe("上班中");
    expect(staffD.kind).toBe("time_off");
    expect(formatStaffDayHeaderMeta(staffD)).toBe("休假");
  });

  it("places the fixture now-line at 13:24 inside the visible day grid", () => {
    expect(
      shouldShowNowLine(CALENDAR_VISUAL_FIXTURE_DAY, CALENDAR_VISUAL_FIXTURE_NOW),
    ).toBe(true);
    expect(formatNowHm(CALENDAR_VISUAL_FIXTURE_NOW)).toBe("13:24");
    expect(
      nowLineTopPx({
        now: CALENDAR_VISUAL_FIXTURE_NOW,
        visibleStartMinutes: DAY_START,
        visibleEndMinutes: DAY_END,
        slotMinutes: CALENDAR_SLOT_MINUTES,
        slotPx: CALENDAR_SLOT_PX,
      }),
    ).toBe(264);
  });
});

describe("calendar quick view selection", () => {
  const day = new Date(2026, 8, 28);
  const weekStart = new Date(2026, 8, 28);
  const booked = apt({
    id: "apt-wang",
    staffId: "staff-001",
    startAt: new Date(2026, 8, 28, 10, 0).toISOString(),
    endAt: new Date(2026, 8, 28, 11, 40).toISOString(),
    durationMinutes: 100,
    status: "BOOKED",
    customerName: "王小美",
  });
  const later = apt({
    id: "apt-lin",
    staffId: "staff-001",
    startAt: new Date(2026, 8, 28, 11, 30).toISOString(),
    endAt: new Date(2026, 8, 28, 13, 0).toISOString(),
    durationMinutes: 90,
    status: "COMPLETED",
    customerName: "林雅婷",
  });
  const otherDay = apt({
    id: "apt-next",
    staffId: "staff-001",
    startAt: new Date(2026, 8, 29, 10, 0).toISOString(),
    endAt: new Date(2026, 8, 29, 11, 0).toISOString(),
    durationMinutes: 60,
    status: "BOOKED",
  });

  it("1. desktop + no selection → Quick View does not render", () => {
    expect(resolveSelectedAppointment([booked, later], null)).toBeNull();
    expect(
      shouldRenderQuickView({
        selected: null,
        editing: false,
        creating: false,
      }),
    ).toBe(false);
  });

  it("2. desktop click sets selectedAppointmentId to the appointment id", () => {
    const selectedAppointmentId = booked.id;
    expect(selectedAppointmentId).toBe("apt-wang");
    expect(resolveSelectedAppointment([booked, later], selectedAppointmentId)?.id).toBe(
      "apt-wang",
    );
  });

  it("3. desktop + selected appointment → Quick View renders", () => {
    const selected = resolveSelectedAppointment([booked, later], "apt-wang");
    expect(
      shouldRenderQuickView({
        selected,
        editing: false,
        creating: false,
      }),
    ).toBe(true);
  });

  it("4. Quick View width / desktop layout contract — calendar + QV coexist", () => {
    expect(QUICK_VIEW_WIDTH_PX).toBe(325);
    expect(CALENDAR_INLINE_QUICKVIEW_MIN_PX).toBe(720);
    expect(isInlineQuickViewViewport(1536)).toBe(true);
    expect(isInlineQuickViewViewport(1200)).toBe(true);
    const calendarRemaining = 1536 - 254 - 40 - 16 - QUICK_VIEW_WIDTH_PX;
    expect(calendarRemaining).toBeGreaterThan(800);
  });

  it("5. close clears selected id so Quick View disappears", () => {
    expect(resolveSelectedAppointment([booked, later], null)).toBeNull();
    expect(
      shouldRenderQuickView({
        selected: null,
        editing: false,
        creating: false,
      }),
    ).toBe(false);
  });

  it("6. clicking another appointment updates Quick View content", () => {
    expect(resolveSelectedAppointment([booked, later], "apt-lin")?.customerName).toBe(
      "林雅婷",
    );
    expect(resolveSelectedAppointment([booked, later], "apt-wang")?.customerName).toBe(
      "王小美",
    );
  });

  it("7. date change resets a stale selection", () => {
    expect(
      shouldResetCalendarSelection({
        selectedId: "apt-wang",
        appointments: [booked, later, otherDay],
        view: "day",
        anchor: new Date(2026, 8, 29),
        weekStart,
      }),
    ).toBe(true);
  });

  it("8. staff filter hiding the selected appointment resets selection", () => {
    expect(
      shouldResetCalendarSelection({
        selectedId: "apt-wang",
        appointments: [later],
        view: "day",
        anchor: day,
        weekStart,
      }),
    ).toBe(true);
  });

  it("9. normal rerender does not reset selection", () => {
    const first = shouldResetCalendarSelection({
      selectedId: "apt-wang",
      appointments: [booked, later],
      view: "day",
      anchor: day,
      weekStart,
    });
    const rerender = shouldResetCalendarSelection({
      selectedId: "apt-wang",
      appointments: [booked, later],
      view: "day",
      anchor: day,
      weekStart,
    });
    expect(first).toBe(false);
    expect(rerender).toBe(false);
    expect(resolveSelectedAppointment([booked, later], "apt-wang")?.id).toBe(
      "apt-wang",
    );
  });

  it("10. mobile still renders Quick View (sheet/drawer via CSS, not a second state)", () => {
    expect(
      shouldRenderQuickView({
        selected: booked,
        editing: false,
        creating: false,
      }),
    ).toBe(true);
    expect(isInlineQuickViewViewport(390)).toBe(false);
    expect(QUICK_VIEW_WIDTH_PX).toBe(325);
  });

  it("keyboard Enter / Space activate selection without needing mouse click", () => {
    expect(isAppointmentKeyboardActivation("Enter")).toBe(true);
    expect(isAppointmentKeyboardActivation(" ")).toBe(true);
    expect(isAppointmentKeyboardActivation("Tab")).toBe(false);
    expect(isAppointmentKeyboardActivation("Escape")).toBe(false);
  });

  it("selecting the same appointment id is idempotent", () => {
    const first = resolveSelectedAppointment([booked, later], "apt-wang");
    const again = resolveSelectedAppointment([booked, later], "apt-wang");
    expect(first?.id).toBe("apt-wang");
    expect(again?.id).toBe(first?.id);
    expect(
      shouldRenderQuickView({
        selected: again,
        editing: false,
        creating: false,
      }),
    ).toBe(true);
  });

  it("does not bind Quick View to editor / create dialog state", () => {
    expect(
      shouldRenderQuickView({
        selected: booked,
        editing: true,
        creating: false,
      }),
    ).toBe(false);
    expect(
      shouldRenderQuickView({
        selected: booked,
        editing: false,
        creating: true,
      }),
    ).toBe(false);
  });
});

describe("formatWorkloadHours", () => {
  it("formats hours", () => {
    expect(formatWorkloadHours(8.5)).toBe("8.5h");
    expect(formatWorkloadHours(3)).toBe("3h");
  });
});
