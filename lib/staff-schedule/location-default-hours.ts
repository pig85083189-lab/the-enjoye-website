/**
 * Location / business default working hours.
 * Used when a staff member has no explicit personal schedule.
 * Does not persist and is not a per-employee fake roster.
 */
import {
  CALENDAR_DAY_END_HOUR,
  CALENDAR_DAY_START_HOUR,
} from "@/lib/appointments/calendar-config";
import type { DayOfWeek, StaffWorkingHours } from "./domain";

export const LOCATION_DEFAULT_WORKING_HOURS_ID_PREFIX = "swh-location-default";

export function locationDefaultWorkingHoursWindow(): {
  startTime: string;
  endTime: string;
} {
  return {
    startTime: `${String(CALENDAR_DAY_START_HOUR).padStart(2, "0")}:00`,
    endTime: `${String(CALENDAR_DAY_END_HOUR).padStart(2, "0")}:00`,
  };
}

export function isLocationDefaultWorkingHours(
  hours: Pick<StaffWorkingHours, "id"> | null | undefined,
): boolean {
  return Boolean(hours?.id.startsWith(LOCATION_DEFAULT_WORKING_HOURS_ID_PREFIX));
}

export function createLocationDefaultWorkingHours(input: {
  organizationId: string;
  locationId: string;
  staffId: string;
  dayOfWeek: DayOfWeek;
}): StaffWorkingHours {
  const window = locationDefaultWorkingHoursWindow();
  return {
    id: `${LOCATION_DEFAULT_WORKING_HOURS_ID_PREFIX}-${input.staffId}-${input.dayOfWeek}`,
    organizationId: input.organizationId,
    locationId: input.locationId,
    staffId: input.staffId,
    dayOfWeek: input.dayOfWeek,
    startTime: window.startTime,
    endTime: window.endTime,
    isWorking: true,
    updatedAt: "",
  };
}
