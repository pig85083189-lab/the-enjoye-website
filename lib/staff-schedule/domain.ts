/**
 * Staff scheduling domain — Phase 4.8B.
 * Separate from Appointment; feeds availability checks only.
 */

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sun=0 … Sat=6

export interface StaffWorkingHours {
  id: string;
  organizationId: string;
  locationId: string;
  staffId: string;
  dayOfWeek: DayOfWeek;
  startTime: string; // HH:mm
  endTime: string;
  isWorking: boolean;
  updatedAt: string;
}

/** One-off break (recurring deferred). */
export interface StaffBreak {
  id: string;
  organizationId: string;
  locationId: string;
  staffId: string;
  startAt: string;
  endAt: string;
  label?: string;
  createdAt: string;
}

export type TimeOffStatus = "APPROVED" | "REQUESTED" | "REJECTED";

export interface StaffTimeOff {
  id: string;
  organizationId: string;
  locationId: string;
  staffId: string;
  startAt: string;
  endAt: string;
  reason?: string;
  status: TimeOffStatus;
  createdAt: string;
}

/**
 * Future resource booking (not runtime in 4.8B).
 * Availability engine must not assume staff-only forever.
 */
export type ResourceType = "ROOM" | "BED" | "EQUIPMENT";

export interface Resource {
  id: string;
  organizationId: string;
  locationId: string;
  type: ResourceType;
  name: string;
  isActive: boolean;
}

/** Future: appointment ↔ resource assignment */
export interface AppointmentResource {
  appointmentId: string;
  resourceId: string;
  organizationId: string;
}

/** Future skill matrix — all bookable staff currently treat as capable of all services. */
export interface StaffServiceCapability {
  organizationId: string;
  staffId: string;
  serviceId: string;
}

export type AvailabilityReasonCode =
  | "OUTSIDE_WORKING_HOURS"
  | "BREAK"
  | "TIME_OFF"
  | "APPOINTMENT_CONFLICT"
  | "STAFF_NOT_FOUND"
  | "LOCATION_DENIED"
  | "NOT_BOOKABLE";

export const AVAILABILITY_REASON_LABEL: Record<AvailabilityReasonCode, string> = {
  OUTSIDE_WORKING_HOURS: "此時間不在工作時間內",
  BREAK: "此時段為休息",
  TIME_OFF: "此時段為休假",
  APPOINTMENT_CONFLICT: "已有其他預約",
  STAFF_NOT_FOUND: "找不到美容師",
  LOCATION_DENIED: "美容師無法服務此分店",
  NOT_BOOKABLE: "此人員目前不可接預約",
};

export interface AvailabilityResult {
  available: boolean;
  reasons: AvailabilityReasonCode[];
  /** Human-readable detail, e.g. conflicting customer name */
  details: string[];
  conflictingAppointmentId?: string;
}

export function parseHmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToHm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function dayOfWeekLocal(isoOrDate: string | Date): DayOfWeek {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return d.getDay() as DayOfWeek;
}

export const DAY_OF_WEEK_LABEL: Record<DayOfWeek, string> = {
  0: "日",
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六",
};
