/**
 * Test-only calendar visual fixture.
 *
 * Applies staff-schedule rows through the existing store APIs so isolation
 * tests can assert break / time-off / working-hours presentation semantics.
 *
 * NOT imported by app routes, CalendarPage, or any runtime UI.
 * Does not change production seed data.
 */
import { dayOfWeekLocal } from "@/lib/staff-schedule/domain";
import {
  createBreak,
  createTimeOff,
  upsertWorkingHours,
} from "@/lib/staff-schedule/store";

/** Sunday 2026-09-27 — the Day View reference date. */
export const CALENDAR_VISUAL_FIXTURE_DAY = new Date(2026, 8, 27);
export const CALENDAR_VISUAL_FIXTURE_NOW = new Date(2026, 8, 27, 13, 24);

/**
 * `staffIds` must already exist as bookable memberships for the org/location.
 * The helper only writes schedule rows through public store APIs.
 */
export function applyCalendarVisualFixture(input: {
  organizationId: string;
  locationId: string;
  staffIds: [string, string, string, string];
}): void {
  const { organizationId, locationId, staffIds } = input;
  const day = CALENDAR_VISUAL_FIXTURE_DAY;
  const dow = dayOfWeekLocal(day);
  const [staffA, staffB, staffC, staffD] = staffIds;

  upsertWorkingHours(organizationId, {
    locationId,
    staffId: staffA,
    dayOfWeek: dow,
    startTime: "10:00",
    endTime: "19:00",
    isWorking: true,
  });
  upsertWorkingHours(organizationId, {
    locationId,
    staffId: staffB,
    dayOfWeek: dow,
    startTime: "10:00",
    endTime: "19:00",
    isWorking: true,
  });
  upsertWorkingHours(organizationId, {
    locationId,
    staffId: staffC,
    dayOfWeek: dow,
    startTime: "11:00",
    endTime: "20:00",
    isWorking: true,
  });
  upsertWorkingHours(organizationId, {
    locationId,
    staffId: staffD,
    dayOfWeek: dow,
    startTime: "10:00",
    endTime: "19:00",
    isWorking: true,
  });

  createBreak(organizationId, {
    locationId,
    staffId: staffB,
    startAt: new Date(2026, 8, 27, 12, 0).toISOString(),
    endAt: new Date(2026, 8, 27, 13, 0).toISOString(),
    label: "午休時間",
  });

  createTimeOff(organizationId, {
    locationId,
    staffId: staffD,
    startAt: new Date(2026, 8, 27, 0, 0).toISOString(),
    endAt: new Date(2026, 8, 28, 0, 0).toISOString(),
    status: "APPROVED",
    reason: "休假",
  });
}
