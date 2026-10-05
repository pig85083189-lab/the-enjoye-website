import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasAppointmentConflict,
  occupiesCalendarSlot,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import { staffActiveRangesConflict } from "@/lib/appointments/appointment-staff-overlap";
import { computeStaffWorkload } from "@/lib/calendar/workload";
import {
  isCalendarRemoteCancelEligible,
  resolveCalendarQuickViewActions,
} from "@/lib/appointments/appointment-write-cancel-surface";

const ORG = "org-the-enjoye";
const STAFF = "staff-001";

function apt(
  status: ScheduleAppointment["status"],
  id: string,
): ScheduleAppointment {
  return {
    id,
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    customerId: "cust-1",
    customerName: "QA",
    serviceId: "svc-1",
    serviceName: "Service",
    staffId: STAFF,
    staffName: "Staff",
    startAt: "2026-10-09T02:00:00.000Z",
    endAt: "2026-10-09T03:40:00.000Z",
    durationMinutes: 100,
    status,
    notes: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
  };
}

describe("Phase 1C-6D.2A cancelled calendar slot release", () => {
  it("does not treat CANCELLED or NO_SHOW as active occupancy", () => {
    const booked = apt("BOOKED", "apt-booked1-abcdef");
    const cancelled = apt("CANCELLED", "apt-cancel1-abcdef");
    const noShow = apt("NO_SHOW", "apt-noshow1-abcdef");
    expect(occupiesCalendarSlot("CANCELLED")).toBe(false);
    expect(occupiesCalendarSlot("NO_SHOW")).toBe(false);
    expect(hasAppointmentConflict(booked, [cancelled, noShow])).toBeUndefined();
    expect(
      staffActiveRangesConflict(
        {
          organizationId: ORG,
          staffId: STAFF,
          startAt: booked.startAt,
          endAt: booked.endAt,
          status: "BOOKED",
        },
        {
          organizationId: ORG,
          staffId: STAFF,
          startAt: cancelled.startAt,
          endAt: cancelled.endAt,
          status: "CANCELLED",
        },
      ),
    ).toBe(false);
    const day = new Date(booked.startAt);
    expect(
      computeStaffWorkload({
        staffId: STAFF,
        appointments: [booked, cancelled, noShow],
        from: day,
        toInclusive: day,
      }).count,
    ).toBe(1);
  });

  it("keeps active BOOKED overlap blocking and Cancel terminal", () => {
    const first = apt("BOOKED", "apt-booked1-abcdef");
    const second = apt("BOOKED", "apt-booked2-abcdef");
    expect(hasAppointmentConflict(second, [first])?.id).toBe(first.id);
    expect(
      isCalendarRemoteCancelEligible({
        remoteCancelAvailable: true,
        appointmentId: "apt-muqrindw-yt0l5z",
        status: "CANCELLED",
        updatedAt: "2026-10-03T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      resolveCalendarQuickViewActions({
        readOnly: true,
        allowRemoteCancel: true,
        status: "CANCELLED",
      }).canCancel,
    ).toBe(false);
  });

  it("filters cancelled cards out of Calendar grid occupancy", () => {
    const views = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarViews.tsx"),
      "utf8",
    );
    const overlap = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261003120000_appointment_staff_overlap_exclusion.sql"),
      "utf8",
    );
    const domain = readFileSync(
      path.join(process.cwd(), "lib/appointments/domain.ts"),
      "utf8",
    );
    expect(views).toMatch(/occupiesCalendarSlot/);
    expect(views).toMatch(/occupiesCalendarSlot\(item\.status\)/);
    expect(views).toMatch(/occupiesCalendarSlot\(a\.status\)/);
    expect(overlap).toMatch(/status not in \('CANCELLED', 'NO_SHOW'\)/);
    expect(domain).toMatch(/isAppointmentCancellable/);
    expect(domain).toMatch(/occupiesCalendarSlot/);
  });
});
