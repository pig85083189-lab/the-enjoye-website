import { describe, expect, it } from "vitest";
import {
  CALENDAR_SLOT_MINUTES,
  CALENDAR_SLOT_PX,
} from "@/lib/appointments/calendar-config";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  formatNowHm,
  nowLineTopPx,
  scrollOffsetForNow,
  shouldShowNowLine,
} from "@/lib/calendar/now-line";
import {
  computeStaffWorkload,
  computeTotalWorkload,
  formatWorkloadHours,
  minutesToGridTopPx,
} from "@/lib/calendar/workload";

const DAY_START = 9 * 60;

function apt(
  partial: Partial<ScheduleAppointment> &
    Pick<ScheduleAppointment, "id" | "staffId" | "startAt" | "endAt" | "durationMinutes" | "status">,
): ScheduleAppointment {
  return {
    organizationId: "org-enjoye",
    locationId: "loc-1",
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
});

describe("now line", () => {
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
      visibleEndMinutes: 21 * 60,
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
      visibleEndMinutes: 21 * 60,
      slotMinutes: CALENDAR_SLOT_MINUTES,
      slotPx: CALENDAR_SLOT_PX,
    });
    expect(top).toBeNull();
  });

  it("scrolls near current time", () => {
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
});

describe("formatWorkloadHours", () => {
  it("formats hours", () => {
    expect(formatWorkloadHours(8.5)).toBe("8.5h");
    expect(formatWorkloadHours(3)).toBe("3h");
  });
});
