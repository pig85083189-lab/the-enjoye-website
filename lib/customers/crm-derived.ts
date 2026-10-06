/**
 * Customer CRM presentation helpers — derived view only.
 * Do not treat these labels as Customer domain truth.
 */
import type { Customer, CustomerAlert, CustomerTag } from "@/types";
import { CUSTOMER_SOURCE_LABEL, type CustomerSource } from "@/types/customer";
import {
  parseAppointmentTimestamptz,
  utcIsoToTaipeiLocal,
} from "@/lib/persistence/appointment-time";

export const CUSTOMER_QUICK_VIEW_WIDTH_PX = 325;
/** Desktop list + inline Quick View. Tablet/mobile use sheet + cards. */
export const CUSTOMER_INLINE_QUICKVIEW_MIN_PX = 1200;
export const RECENT_VISIT_DAYS = 14;
export const DORMANT_AFTER_DAYS = 45;

export type CustomerRelationshipStatus =
  | "STABLE"
  | "NEW"
  | "FOLLOW_UP"
  | "DORMANT";

export const RELATIONSHIP_STATUS_LABEL: Record<
  CustomerRelationshipStatus,
  string
> = {
  STABLE: "穩定",
  NEW: "新客",
  FOLLOW_UP: "待追蹤",
  DORMANT: "沉睡",
};

export type AppointmentHint = {
  customerId: string;
  status: string;
  serviceId?: string;
  serviceName: string;
  durationMinutes?: number;
  startAt: string;
  endAt?: string;
  staffName?: string;
};

export type ServiceCatalogHint = {
  id: string;
  name: string;
  durationMinutes: number;
};

export type LastVisitView = {
  dateLabel: string | null;
  relativeLabel: string | null;
};

export type LastServiceView = {
  serviceName: string;
  durationMinutes: number | null;
  dateLabel: string | null;
} | null;

export type NextAppointmentView = {
  dateLabel: string;
  timeLabel: string;
  serviceName?: string;
  staffName?: string;
  startsAt: string;
} | null;

export type CustomerCrmSummary = {
  total: number;
  newThisMonth: number;
  needsFollowUp: number;
  vip: number;
  recent: number;
  newCustomers: number;
};

const EMPTY_ATTENTION = /^(否|無|没有|n\/a|-|—)$/i;
const COMPLETED_STATUSES = new Set(["COMPLETED", "completed"]);
const UPCOMING_STATUSES = new Set([
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "IN_SERVICE",
  "booked",
  "confirmed",
  "in_progress",
]);
const INTEREST_TAG_IDS = new Set(["facial", "breast", "body"]);
const MEMBERSHIP_TAG_IDS = new Set(["vip", "new", "regular"]);

function hasExplicitTimezone(value: string): boolean {
  return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value.trim());
}

/**
 * Instant parse for appointment starts. ISO strings with Z / offset use the
 * real timestamp; wall-clock CRM strings stay on parseCustomerDate.
 */
export function parseAppointmentStartInstant(
  value: string | null | undefined,
): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (hasExplicitTimezone(trimmed)) {
    try {
      return parseAppointmentTimestamptz(trimmed);
    } catch {
      return null;
    }
  }
  return parseCustomerDate(trimmed);
}

/** Taipei labels for zoned ISO; wall-clock CRM strings keep local formatting. */
export function formatAppointmentStartLabel(
  startAt: string,
): { dateLabel: string; timeLabel: string } | null {
  if (hasExplicitTimezone(startAt)) {
    try {
      const taipei = utcIsoToTaipeiLocal(startAt);
      const [year, month, day] = taipei.dateYmd.split("-");
      return {
        dateLabel: `${year}/${month}/${day}`,
        timeLabel: taipei.hm,
      };
    } catch {
      return null;
    }
  }
  const parsed = parseCustomerDate(startAt);
  if (!parsed) return null;
  return {
    dateLabel: formatSlashDate(parsed),
    timeLabel: formatHmLabel(parsed),
  };
}

export function parseCustomerDate(
  value: string | null | undefined,
): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const wall = trimmed.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (wall) {
    return new Date(
      Number(wall[1]),
      Number(wall[2]) - 1,
      Number(wall[3]),
      Number(wall[4] ?? 0),
      Number(wall[5] ?? 0),
      Number(wall[6] ?? 0),
    );
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function daysBetween(from: Date, to: Date): number {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function formatSlashDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

export function formatHmLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatLastVisitRelative(
  lastVisit: string | null | undefined,
  now: Date,
): LastVisitView {
  const parsed = parseCustomerDate(lastVisit);
  if (!parsed) {
    return {
      dateLabel: lastVisit?.trim() ? lastVisit.trim() : null,
      relativeLabel: null,
    };
  }
  const days = daysBetween(parsed, now);
  let relativeLabel: string;
  if (days === 0) relativeLabel = "今天";
  else if (days === 1) relativeLabel = "1 天前";
  else if (days > 1) relativeLabel = `${days} 天前`;
  else if (days === -1) relativeLabel = "1 天後";
  else relativeLabel = `${Math.abs(days)} 天後`;
  return {
    dateLabel: formatSlashDate(parsed),
    relativeLabel,
  };
}

export function isVipCustomer(customer: Customer): boolean {
  return (
    customer.membership === "vip" ||
    customer.tags.some((tag) => tag.id === "vip")
  );
}

export function isNewCustomer(customer: Customer): boolean {
  return (
    customer.membership === "new" ||
    customer.tags.some((tag) => tag.id === "new")
  );
}

export function needsFollowUp(customer: Customer): boolean {
  return (
    customer.listStatus === "needs_follow_up" ||
    customer.tags.some((tag) => tag.id === "needs_follow_up")
  );
}

export function isRecentVisit(
  customer: Customer,
  now: Date,
  withinDays = RECENT_VISIT_DAYS,
): boolean {
  const parsed = parseCustomerDate(customer.lastVisit);
  if (!parsed) return false;
  const days = daysBetween(parsed, now);
  return days >= 0 && days <= withinDays;
}

export function isNewThisMonth(customer: Customer, now: Date): boolean {
  const joined =
    parseCustomerDate(customer.createdAt) ??
    parseCustomerDate(customer.joinedAt);
  if (!joined) return false;
  return (
    joined.getFullYear() === now.getFullYear() &&
    joined.getMonth() === now.getMonth()
  );
}

/**
 * Conservative derived relationship — presentation only.
 * Priority: follow-up signal → new → dormant last visit → stable fallback.
 */
export function deriveCustomerRelationshipStatus(
  customer: Customer,
  now: Date,
): CustomerRelationshipStatus {
  if (needsFollowUp(customer)) return "FOLLOW_UP";
  if (isNewCustomer(customer)) return "NEW";
  const parsed = parseCustomerDate(customer.lastVisit);
  if (parsed) {
    const days = daysBetween(parsed, now);
    if (days >= DORMANT_AFTER_DAYS) return "DORMANT";
  }
  return "STABLE";
}

export function countCustomerCrmSummary(
  customers: Customer[],
  now: Date,
): CustomerCrmSummary {
  return {
    total: customers.length,
    newThisMonth: customers.filter((c) => isNewThisMonth(c, now)).length,
    needsFollowUp: customers.filter((c) => needsFollowUp(c)).length,
    vip: customers.filter((c) => isVipCustomer(c)).length,
    recent: customers.filter((c) => isRecentVisit(c, now)).length,
    newCustomers: customers.filter((c) => isNewCustomer(c)).length,
  };
}

function matchCatalogService(
  name: string,
  catalog: ServiceCatalogHint[] | undefined,
): ServiceCatalogHint | undefined {
  if (!catalog?.length || !name) return undefined;
  const exact = catalog.find((item) => item.name === name);
  if (exact) return exact;
  return catalog.find(
    (item) => item.name.includes(name) || name.includes(item.name),
  );
}

function isCompletedStatus(status: string): boolean {
  return COMPLETED_STATUSES.has(status);
}

function isUpcomingStatus(status: string): boolean {
  return UPCOMING_STATUSES.has(status);
}

export function deriveLastService(input: {
  customer: Customer;
  appointments?: AppointmentHint[];
  catalog?: ServiceCatalogHint[];
}): LastServiceView {
  const { customer, appointments = [], catalog } = input;
  const completed = appointments
    .filter(
      (item) =>
        item.customerId === customer.id && isCompletedStatus(item.status),
    )
    .sort((a, b) => b.startAt.localeCompare(a.startAt));
  const latest = completed[0];
  if (latest) {
    const fromCatalog =
      (latest.serviceId
        ? catalog?.find((item) => item.id === latest.serviceId)
        : undefined) ?? matchCatalogService(latest.serviceName, catalog);
    const visit = formatLastVisitRelative(customer.lastVisit, new Date(0));
    return {
      serviceName: fromCatalog?.name ?? latest.serviceName,
      durationMinutes:
        latest.durationMinutes ?? fromCatalog?.durationMinutes ?? null,
      dateLabel: visit.dateLabel,
    };
  }

  const fallbackName = customer.lastServiceName?.trim();
  if (!fallbackName) return null;
  const fromCatalog = matchCatalogService(fallbackName, catalog);
  const visit = formatLastVisitRelative(customer.lastVisit, new Date(0));
  return {
    serviceName: fromCatalog?.name ?? fallbackName,
    durationMinutes: fromCatalog?.durationMinutes ?? null,
    dateLabel: visit.dateLabel,
  };
}

export function deriveNextAppointment(input: {
  customer: Customer;
  appointments?: AppointmentHint[];
  now: Date;
}): NextAppointmentView {
  const { customer, appointments = [], now } = input;
  const upcoming = appointments
    .filter((item) => {
      if (item.customerId !== customer.id || !isUpcomingStatus(item.status)) {
        return false;
      }
      const activeUntil = parseAppointmentStartInstant(item.endAt ?? item.startAt);
      return activeUntil !== null && activeUntil.getTime() >= now.getTime();
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const next = upcoming[0];
  if (next) {
    const labels = formatAppointmentStartLabel(next.startAt);
    if (!labels) return null;
    return {
      dateLabel: labels.dateLabel,
      timeLabel: labels.timeLabel,
      serviceName: next.serviceName,
      startsAt: next.startAt,
      ...(next.staffName ? { staffName: next.staffName } : {}),
    };
  }

  const fallbackRaw = customer.nextAppointmentAt ?? undefined;
  const fallback = parseAppointmentStartInstant(fallbackRaw);
  if (fallback && fallback.getTime() >= now.getTime() && fallbackRaw) {
    const labels = formatAppointmentStartLabel(fallbackRaw);
    if (!labels) return null;
    return {
      dateLabel: labels.dateLabel,
      timeLabel: labels.timeLabel,
      serviceName: undefined,
      startsAt: fallbackRaw,
    };
  }
  return null;
}

function usefulAlertText(alert: CustomerAlert): string | null {
  const value = alert.value?.trim() ?? "";
  const label = alert.label?.trim() ?? "";
  if (alert.tone === "success") return null;
  if (EMPTY_ATTENTION.test(value)) return null;
  if (alert.tone === "warning") return value || label || null;
  if (!value || EMPTY_ATTENTION.test(value)) return null;
  return value;
}

export function collectCustomerAttentionNotes(
  customer: Customer,
  extras: Array<string | null | undefined> = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  function push(raw: string | null | undefined) {
    const text = raw?.trim();
    if (!text || EMPTY_ATTENTION.test(text) || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  }

  for (const note of customer.importantNotes ?? []) push(note);
  for (const alert of customer.alerts ?? []) push(usefulAlertText(alert));
  for (const note of customer.lastServiceNotes ?? []) push(note);
  for (const focus of customer.trackingFocus ?? []) push(focus);
  for (const extra of extras) push(extra);

  return out.slice(0, 6);
}

export function serviceInterestTags(customer: Customer): CustomerTag[] {
  return customer.tags.filter((tag) => INTEREST_TAG_IDS.has(tag.id));
}

export function lifecycleTags(customer: Customer): CustomerTag[] {
  return customer.tags.filter((tag) => MEMBERSHIP_TAG_IDS.has(tag.id));
}

export function sourceLabel(source: CustomerSource | undefined): string | null {
  if (!source) return null;
  return CUSTOMER_SOURCE_LABEL[source] ?? source;
}

export function membershipBadge(
  customer: Customer,
): { id: "vip" | "new"; label: string } | null {
  if (isVipCustomer(customer)) return { id: "vip", label: "VIP" };
  if (isNewCustomer(customer)) return { id: "new", label: "新客" };
  return null;
}

export function resolveSelectedCustomer(
  customers: Customer[],
  selectedId: string | null,
): Customer | null {
  if (!selectedId) return null;
  return customers.find((item) => item.id === selectedId) ?? null;
}

export function shouldResetCustomerSelection(input: {
  selectedId: string | null;
  visibleCustomers: Customer[];
}): boolean {
  if (!input.selectedId) return false;
  return !input.visibleCustomers.some((item) => item.id === input.selectedId);
}

export function shouldRenderCustomerQuickView(
  selected: Customer | null,
): boolean {
  return selected !== null;
}

export function isInlineCustomerQuickViewViewport(widthPx: number): boolean {
  return widthPx >= CUSTOMER_INLINE_QUICKVIEW_MIN_PX;
}

export function customerListPresentation(
  widthPx: number,
): "desktop-table" | "mobile-cards" {
  return isInlineCustomerQuickViewViewport(widthPx)
    ? "desktop-table"
    : "mobile-cards";
}

export function isCustomerRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}
