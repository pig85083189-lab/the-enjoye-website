import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { canAccessLocation } from "@/lib/tenant/access";
import {
  getStaffBreaksKey,
  getStaffTimeOffKey,
  getStaffWorkingHoursKey,
} from "@/lib/tenant/storage-keys";
import { newId } from "@/lib/repositories/storage";
import {
  CALENDAR_DAY_END_HOUR,
  CALENDAR_DAY_START_HOUR,
} from "@/lib/appointments/calendar-config";
import type {
  DayOfWeek,
  StaffBreak,
  StaffTimeOff,
  StaffWorkingHours,
} from "./domain";
import { canReceiveAppointments } from "./capability";

const SCHEDULE_EVENT = "enjoye-staff-schedule-change";

export function subscribeStaffSchedule(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(SCHEDULE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(SCHEDULE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function getStaffScheduleRevision(): string {
  if (typeof window === "undefined") return "";
  // Concatenate keys so any schedule write invalidates consumers.
  return [
    localStorage.getItem("beauty-os:schedule-rev") ?? "",
    ...Object.keys(localStorage).filter((k) =>
      k.includes(":staff-working-hours:") ||
      k.includes(":staff-breaks:") ||
      k.includes(":staff-time-off:"),
    ),
  ].join("|");
}

function emit(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("beauty-os:schedule-rev", String(Date.now()));
  window.dispatchEvent(new Event(SCHEDULE_EVENT));
}

function readJson<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function writeJson<T extends { organizationId: string }>(
  organizationId: string,
  key: string,
  list: T[],
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    key,
    JSON.stringify(list.filter((item) => item.organizationId === organizationId)),
  );
  emit();
}

function assertOrgLocation(organizationId: string, locationId: string): void {
  if (!canAccessLocation(organizationId, locationId)) {
    throw new Error("Location does not belong to this organization");
  }
}

function assertStaffMembership(
  organizationId: string,
  staffId: string,
  locationId: string,
): void {
  const membership = SEED_MEMBERSHIPS.find(
    (m) => m.organizationId === organizationId && m.userId === staffId && m.isActive,
  );
  if (!membership) {
    throw new Error("Staff membership does not belong to this organization");
  }
  if (membership.locationIds.length > 0 && !membership.locationIds.includes(locationId)) {
    throw new Error("Staff cannot operate this location");
  }
  if (!canReceiveAppointments(membership)) {
    throw new Error("Staff cannot receive appointments");
  }
}

function defaultHoursForStaff(
  organizationId: string,
  locationId: string,
  staffId: string,
): StaffWorkingHours[] {
  const now = new Date().toISOString();
  const start = `${String(CALENDAR_DAY_START_HOUR).padStart(2, "0")}:00`;
  const end = `${String(CALENDAR_DAY_END_HOUR).padStart(2, "0")}:00`;
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const isWorking = dayOfWeek !== 0; // Sunday off by default
    return {
      id: newId("swh"),
      organizationId,
      locationId,
      staffId,
      dayOfWeek: dayOfWeek as DayOfWeek,
      startTime: start,
      endTime: end,
      isWorking,
      updatedAt: now,
    };
  });
}

/** Bookable staff for a location (from StaffMembership — no parallel mock roster). */
export function listBookableStaff(organizationId: string, locationId: string) {
  return SEED_MEMBERSHIPS.filter(
    (m) =>
      m.organizationId === organizationId &&
      m.isActive &&
      canReceiveAppointments(m) &&
      (m.locationIds.length === 0 || m.locationIds.includes(locationId)),
  );
}

export function listWorkingHours(
  organizationId: string,
  opts?: { locationId?: string; staffId?: string },
): StaffWorkingHours[] {
  const key = getStaffWorkingHoursKey(organizationId);
  let list = readJson<StaffWorkingHours>(key).filter(
    (item) => item.organizationId === organizationId,
  );

  // Seed defaults once per staff/location when empty for that pair.
  if (opts?.locationId && opts?.staffId) {
    const has = list.some(
      (item) => item.locationId === opts.locationId && item.staffId === opts.staffId,
    );
    if (!has) {
      assertOrgLocation(organizationId, opts.locationId);
      assertStaffMembership(organizationId, opts.staffId, opts.locationId);
      const seeded = defaultHoursForStaff(organizationId, opts.locationId, opts.staffId);
      list = [...list, ...seeded];
      writeJson(organizationId, key, list);
    }
  }

  if (opts?.locationId) list = list.filter((item) => item.locationId === opts.locationId);
  if (opts?.staffId) list = list.filter((item) => item.staffId === opts.staffId);
  return list;
}

export function getWorkingHoursForDay(
  organizationId: string,
  locationId: string,
  staffId: string,
  dayOfWeek: DayOfWeek,
): StaffWorkingHours | undefined {
  return listWorkingHours(organizationId, { locationId, staffId }).find(
    (item) => item.dayOfWeek === dayOfWeek,
  );
}

export function upsertWorkingHours(
  organizationId: string,
  input: Omit<StaffWorkingHours, "id" | "organizationId" | "updatedAt"> & { id?: string },
): StaffWorkingHours {
  assertOrgLocation(organizationId, input.locationId);
  assertStaffMembership(organizationId, input.staffId, input.locationId);
  if (input.isWorking) {
    const [sh, sm] = input.startTime.split(":").map(Number);
    const [eh, em] = input.endTime.split(":").map(Number);
    if ((eh ?? 0) * 60 + (em ?? 0) <= (sh ?? 0) * 60 + (sm ?? 0)) {
      throw new Error("endTime must be after startTime");
    }
  }
  const key = getStaffWorkingHoursKey(organizationId);
  const list = readJson<StaffWorkingHours>(key).filter(
    (item) => item.organizationId === organizationId,
  );
  const existing = list.find(
    (item) =>
      (input.id && item.id === input.id) ||
      (item.locationId === input.locationId &&
        item.staffId === input.staffId &&
        item.dayOfWeek === input.dayOfWeek),
  );
  const next: StaffWorkingHours = {
    id: existing?.id ?? input.id ?? newId("swh"),
    organizationId,
    locationId: input.locationId,
    staffId: input.staffId,
    dayOfWeek: input.dayOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    isWorking: input.isWorking,
    updatedAt: new Date().toISOString(),
  };
  const rest = list.filter((item) => item.id !== next.id);
  writeJson(organizationId, key, [next, ...rest]);
  return next;
}

export function listBreaks(
  organizationId: string,
  opts?: { locationId?: string; staffId?: string; from?: Date; to?: Date },
): StaffBreak[] {
  let list = readJson<StaffBreak>(getStaffBreaksKey(organizationId)).filter(
    (item) => item.organizationId === organizationId,
  );
  if (opts?.locationId) list = list.filter((item) => item.locationId === opts.locationId);
  if (opts?.staffId) list = list.filter((item) => item.staffId === opts.staffId);
  if (opts?.from || opts?.to) {
    const from = opts.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const to = opts.to?.getTime() ?? Number.POSITIVE_INFINITY;
    list = list.filter((item) => {
      const s = new Date(item.startAt).getTime();
      const e = new Date(item.endAt).getTime();
      return s < to && e > from;
    });
  }
  return list;
}

export function createBreak(
  organizationId: string,
  input: Omit<StaffBreak, "id" | "organizationId" | "createdAt">,
): StaffBreak {
  assertOrgLocation(organizationId, input.locationId);
  assertStaffMembership(organizationId, input.staffId, input.locationId);
  if (!(new Date(input.endAt) > new Date(input.startAt))) {
    throw new Error("endAt must be after startAt");
  }
  const row: StaffBreak = {
    ...input,
    id: newId("brk"),
    organizationId,
    createdAt: new Date().toISOString(),
  };
  const key = getStaffBreaksKey(organizationId);
  writeJson(organizationId, key, [row, ...listBreaks(organizationId)]);
  return row;
}

export function deleteBreak(organizationId: string, breakId: string): void {
  const key = getStaffBreaksKey(organizationId);
  const next = listBreaks(organizationId).filter(
    (item) => item.id !== breakId && item.organizationId === organizationId,
  );
  const found = listBreaks(organizationId).find((item) => item.id === breakId);
  if (!found || found.organizationId !== organizationId) {
    throw new Error("Break not found");
  }
  writeJson(organizationId, key, next);
}

export function listTimeOff(
  organizationId: string,
  opts?: { locationId?: string; staffId?: string; from?: Date; to?: Date },
): StaffTimeOff[] {
  let list = readJson<StaffTimeOff>(getStaffTimeOffKey(organizationId)).filter(
    (item) => item.organizationId === organizationId,
  );
  if (opts?.locationId) list = list.filter((item) => item.locationId === opts.locationId);
  if (opts?.staffId) list = list.filter((item) => item.staffId === opts.staffId);
  if (opts?.from || opts?.to) {
    const from = opts.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const to = opts.to?.getTime() ?? Number.POSITIVE_INFINITY;
    list = list.filter((item) => {
      const s = new Date(item.startAt).getTime();
      const e = new Date(item.endAt).getTime();
      return s < to && e > from;
    });
  }
  return list;
}

export function createTimeOff(
  organizationId: string,
  input: Omit<StaffTimeOff, "id" | "organizationId" | "createdAt" | "status"> & {
    status?: StaffTimeOff["status"];
  },
): StaffTimeOff {
  assertOrgLocation(organizationId, input.locationId);
  assertStaffMembership(organizationId, input.staffId, input.locationId);
  if (!(new Date(input.endAt) > new Date(input.startAt))) {
    throw new Error("endAt must be after startAt");
  }
  const row: StaffTimeOff = {
    id: newId("toff"),
    organizationId,
    locationId: input.locationId,
    staffId: input.staffId,
    startAt: input.startAt,
    endAt: input.endAt,
    reason: input.reason,
    status: input.status ?? "APPROVED",
    createdAt: new Date().toISOString(),
  };
  const key = getStaffTimeOffKey(organizationId);
  writeJson(organizationId, key, [row, ...listTimeOff(organizationId)]);
  return row;
}

export function deleteTimeOff(organizationId: string, timeOffId: string): void {
  const found = listTimeOff(organizationId).find((item) => item.id === timeOffId);
  if (!found || found.organizationId !== organizationId) {
    throw new Error("Time off not found");
  }
  const key = getStaffTimeOffKey(organizationId);
  writeJson(
    organizationId,
    key,
    listTimeOff(organizationId).filter((item) => item.id !== timeOffId),
  );
}
