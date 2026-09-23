/**
 * Appointment domain — Phase 4.8A.
 * Canonical datetimes + lifecycle. Legacy pending/in_progress/completed are normalized.
 */

export type CanonicalAppointmentStatus =
  | "DRAFT"
  | "BOOKED"
  | "CONFIRMED"
  | "ARRIVED"
  | "IN_SERVICE"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

/** Pre-4.8A statuses still stored in overlays / mock seeds */
export type LegacyAppointmentStatus = "pending" | "in_progress" | "completed";

export type AnyAppointmentStatus = CanonicalAppointmentStatus | LegacyAppointmentStatus;

export interface ScheduleAppointment {
  id: string;
  organizationId: string;
  locationId: string;
  customerId: string;
  customerName: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  status: CanonicalAppointmentStatus;
  customerNote?: string;
  internalNote?: string;
  membership?: "vip" | "regular" | "new";
  remainingSessions?: number;
  /** Legacy reminder chips */
  notes: string[];
  statusReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  createdBy?: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
}

export const STATUS_LABEL: Record<CanonicalAppointmentStatus, string> = {
  DRAFT: "草稿",
  BOOKED: "已預約",
  CONFIRMED: "已確認",
  ARRIVED: "已到店",
  IN_SERVICE: "服務中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  NO_SHOW: "未到",
};

const TRANSITIONS: Record<CanonicalAppointmentStatus, CanonicalAppointmentStatus[]> = {
  DRAFT: ["BOOKED", "CANCELLED"],
  BOOKED: ["CONFIRMED", "CANCELLED", "NO_SHOW", "ARRIVED"],
  CONFIRMED: ["ARRIVED", "CANCELLED", "NO_SHOW"],
  ARRIVED: ["IN_SERVICE", "CANCELLED", "NO_SHOW"],
  IN_SERVICE: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function normalizeAppointmentStatus(
  status: string | undefined | null,
): CanonicalAppointmentStatus {
  switch (status) {
    case "pending":
    case "BOOKED":
      return "BOOKED";
    case "confirmed":
    case "CONFIRMED":
      return "CONFIRMED";
    case "ARRIVED":
      return "ARRIVED";
    case "in_progress":
    case "IN_SERVICE":
      return "IN_SERVICE";
    case "completed":
    case "COMPLETED":
      return "COMPLETED";
    case "DRAFT":
      return "DRAFT";
    case "cancelled":
    case "CANCELLED":
      return "CANCELLED";
    case "no_show":
    case "NO_SHOW":
      return "NO_SHOW";
    default:
      return "BOOKED";
  }
}

export function canTransition(
  from: CanonicalAppointmentStatus,
  to: CanonicalAppointmentStatus,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: CanonicalAppointmentStatus,
  to: CanonicalAppointmentStatus,
): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid appointment transition: ${from} → ${to}`);
  }
}

export function allowedTransitions(
  from: CanonicalAppointmentStatus,
): CanonicalAppointmentStatus[] {
  return [...TRANSITIONS[from]];
}

/** Today visual buckets — cancelled/no-show stay visible but muted */
export function todayBucket(
  status: CanonicalAppointmentStatus,
): "waiting" | "active" | "done" | "muted" {
  if (status === "IN_SERVICE") return "active";
  if (status === "COMPLETED") return "done";
  if (status === "CANCELLED" || status === "NO_SHOW") return "muted";
  return "waiting";
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function formatHm(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatYmd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Combine local calendar date + HH:mm into a Date */
export function combineLocalDateTime(dateYmd: string, hm: string): Date {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

export function durationBetween(startAt: string, endAt: string): number {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  return Math.max(0, Math.round(ms / 60_000));
}

export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd).getTime();
  return as < be && ae > bs;
}

export function hasAppointmentConflict(
  candidate: Pick<ScheduleAppointment, "id" | "staffId" | "startAt" | "endAt" | "status">,
  existing: ScheduleAppointment[],
): ScheduleAppointment | undefined {
  if (candidate.status === "CANCELLED" || candidate.status === "NO_SHOW") return undefined;
  return existing.find((item) => {
    if (item.id === candidate.id) return false;
    if (item.staffId !== candidate.staffId) return false;
    if (item.status === "CANCELLED" || item.status === "NO_SHOW") return false;
    return rangesOverlap(candidate.startAt, candidate.endAt, item.startAt, item.endAt);
  });
}

export function isSameLocalDay(iso: string, day: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
}

/** Seed rows only have HH:mm — anchor them to a calendar day (prototype "today"). */
export function anchorTimeOnDay(hm: string, day: Date, durationMinutes: number): {
  startAt: string;
  endAt: string;
} {
  const [hh, mm] = hm.split(":").map(Number);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh ?? 0, mm ?? 0, 0, 0);
  const end = addMinutes(start, durationMinutes);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}
