/**
 * Staff onboarding — presentation / validation / schedule payload planning only.
 * Persistence stays on createMembership + upsertWorkingHours.
 */
import {
  CALENDAR_DAY_END_HOUR,
  CALENDAR_DAY_START_HOUR,
} from "@/lib/appointments/calendar-config";
import { NAVIGATION_ITEMS } from "@/lib/navigation/config";
import { isNavItemVisibleForRole } from "@/lib/navigation/resolve";
import type { DayOfWeek } from "@/lib/staff-schedule/domain";
import { DAY_OF_WEEK_LABEL } from "@/lib/staff-schedule/domain";
import type { StaffApplyHoursDraft } from "@/lib/staff/staff-workspace-derived";
import type { Location, StaffRole } from "@/types/saas";

export const STAFF_HAS_AUTH_ACCOUNT_CREATE = false;
export const STAFF_HAS_EMPLOYEE_DOMAIN = false;
export const STAFF_HAS_SECOND_MEMBERSHIP_STORE = false;

export type StaffOnboardingStep = 1 | 2 | 3;
export type StaffOnboardingScheduleMode = "later" | "basic";

export const STAFF_ROLE_PRESENTATION: Record<StaffRole, string> = {
  OWNER: "店主",
  MANAGER: "店長",
  STAFF: "美容師",
  RECEPTIONIST: "櫃台",
  ACCOUNTANT: "會計",
};

export const STAFF_ONBOARDING_ROLES: StaffRole[] = [
  "OWNER",
  "MANAGER",
  "STAFF",
  "RECEPTIONIST",
  "ACCOUNTANT",
];

export interface StaffOnboardingDayHours {
  dayOfWeek: DayOfWeek;
  isWorking: boolean;
  startTime: string;
  endTime: string;
}

export interface StaffOnboardingDraft {
  displayName: string;
  role: StaffRole;
  locationIds: string[];
  scheduleMode: StaffOnboardingScheduleMode;
  hours: StaffOnboardingDayHours[];
}

export const STAFF_ONBOARDING_STEPS: Array<{
  id: StaffOnboardingStep;
  label: string;
}> = [
  { id: 1, label: "基本資料" },
  { id: 2, label: "角色與分店" },
  { id: 3, label: "初始班表" },
];

/** Mirrors canonical /staff/staff nav roles (staff.manage → OWNER / MANAGER). */
export function canManageStaff(role: StaffRole | undefined): boolean {
  const staffNav = NAVIGATION_ITEMS.find((item) => item.id === "staff");
  if (!staffNav) return false;
  return isNavItemVisibleForRole(staffNav, role);
}

export function staffOnboardingDayLabel(dayOfWeek: DayOfWeek): string {
  return `星期${DAY_OF_WEEK_LABEL[dayOfWeek]}`;
}

export function toggleOnboardingLocation(
  locationIds: string[],
  locationId: string,
): string[] {
  if (locationIds.includes(locationId)) {
    return locationIds.filter((id) => id !== locationId);
  }
  return [...locationIds, locationId];
}

export function emptyOnboardingDraft(defaultLocationId?: string): StaffOnboardingDraft {
  return {
    displayName: "",
    role: "STAFF",
    locationIds: defaultLocationId ? [defaultLocationId] : [],
    scheduleMode: "later",
    hours: defaultOnboardingHours(),
  };
}

export function defaultOnboardingHours(): StaffOnboardingDayHours[] {
  const startTime = `${String(CALENDAR_DAY_START_HOUR).padStart(2, "0")}:00`;
  const endTime = `${String(CALENDAR_DAY_END_HOUR).padStart(2, "0")}:00`;
  return ([1, 2, 3, 4, 5, 6, 0] as DayOfWeek[]).map((dayOfWeek) => ({
    dayOfWeek,
    isWorking: dayOfWeek !== 0,
    startTime,
    endTime,
  }));
}

export function applyOnboardingHoursPattern(
  hours: StaffOnboardingDayHours[],
  pattern: "mon-fri" | "mon-sat",
): StaffOnboardingDayHours[] {
  const source =
    hours.find((item) => item.dayOfWeek === 1 && item.isWorking) ??
    hours.find((item) => item.isWorking) ??
    defaultOnboardingHours()[0]!;
  const working = new Set(pattern === "mon-fri" ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6]);
  return hours.map((item) => ({
    ...item,
    isWorking: working.has(item.dayOfWeek),
    startTime: working.has(item.dayOfWeek) ? source.startTime : item.startTime,
    endTime: working.has(item.dayOfWeek) ? source.endTime : item.endTime,
  }));
}

export function isOnboardingTimeValid(startTime: string, endTime: string): boolean {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return (eh ?? 0) * 60 + (em ?? 0) > (sh ?? 0) * 60 + (sm ?? 0);
}

export function validateOnboardingStep1(draft: StaffOnboardingDraft): string | null {
  if (!draft.displayName.trim()) return "請填寫員工姓名";
  return null;
}

export function validateOnboardingStep2(
  draft: StaffOnboardingDraft,
  locations: Location[],
): string | null {
  if (!STAFF_ONBOARDING_ROLES.includes(draft.role)) return "請選擇角色";
  if (draft.locationIds.length === 0) return "請至少選擇一間分店";
  const allowed = new Set(locations.map((item) => item.id));
  if (draft.locationIds.some((id) => !allowed.has(id))) return "分店不屬於目前店家";
  return null;
}

export function validateOnboardingStep3(draft: StaffOnboardingDraft): string | null {
  if (draft.scheduleMode === "later") return null;
  const invalid = draft.hours.find(
    (item) => item.isWorking && !isOnboardingTimeValid(item.startTime, item.endTime),
  );
  if (invalid) return "上班結束時間必須晚於開始時間";
  return null;
}

export function validateOnboardingDraft(
  draft: StaffOnboardingDraft,
  locations: Location[],
): string | null {
  return (
    validateOnboardingStep1(draft) ??
    validateOnboardingStep2(draft, locations) ??
    validateOnboardingStep3(draft)
  );
}

export function validateOnboardingStep(
  step: StaffOnboardingStep,
  draft: StaffOnboardingDraft,
  locations: Location[],
): string | null {
  if (step === 1) return validateOnboardingStep1(draft);
  if (step === 2) return validateOnboardingStep2(draft, locations);
  return validateOnboardingStep3(draft);
}

export function planOnboardingWorkingHours(input: {
  staffId: string;
  locationIds: string[];
  hours: StaffOnboardingDayHours[];
}): StaffApplyHoursDraft[] {
  const drafts: StaffApplyHoursDraft[] = [];
  for (const locationId of input.locationIds) {
    for (const day of input.hours) {
      drafts.push({
        locationId,
        staffId: input.staffId,
        dayOfWeek: day.dayOfWeek,
        startTime: day.startTime,
        endTime: day.endTime,
        isWorking: day.isWorking,
      });
    }
  }
  return drafts;
}

export function staffOnboardingIdentityPrefixes(): { membership: "mem"; user: "staff" } {
  return { membership: "mem", user: "staff" };
}
