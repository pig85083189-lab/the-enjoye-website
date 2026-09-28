/**
 * Treatment Workspace presentation helpers — derived view only.
 * Reads existing TreatmentDraft / ScheduleAppointment / Customer fields.
 * Does not persist a second treatment status or store.
 */
import { serviceTypeCardTone } from "@/features/calendar/grid-shared";
import { formatHm, type CanonicalAppointmentStatus, type ScheduleAppointment } from "@/lib/appointments/domain";
import type { AppointmentCheckoutNav } from "@/lib/commerce/appointment-checkout-nav";
import {
  collectCustomerAttentionNotes,
  formatSlashDate,
  membershipBadge,
  type ServiceCatalogHint,
} from "@/lib/customers/crm-derived";
import { getStepCompletionState } from "@/lib/treatment-draft";
import { formatReminderTag } from "@/lib/utils";
import type { Customer } from "@/types";
import type { TreatmentDraft, TreatmentStepId } from "@/types/treatment";

export const TREATMENT_QUICK_VIEW_WIDTH_PX = 325;
export const TREATMENT_INLINE_QUICKVIEW_MIN_PX = 1200;
export const TREATMENT_WORKSPACE_GAP_PX = 16;

export type TreatmentListFilter = "open" | "completed" | "all";
export type TreatmentDateFilter = "today" | "7d" | "all";
export type TreatmentRowKind = "draft" | "completed" | "appointment";

export type TreatmentWorkspaceStatusKind =
  | "in_progress"
  | "completed"
  | "record_incomplete"
  | "not_started";

export const RECORD_SECTIONS = [
  { id: "bodyMap", label: "Body Map", shortLabel: "部位" },
  { id: "photos", label: "療程照片", shortLabel: "照片" },
  { id: "professionalNote", label: "專業備註", shortLabel: "備註" },
  { id: "followUp", label: "追蹤事項", shortLabel: "追蹤" },
] as const;

export type RecordSectionId = (typeof RECORD_SECTIONS)[number]["id"];

export type TreatmentCatalogHint = ServiceCatalogHint & {
  serviceType?: string;
  category?: string;
};

export interface RecordSectionProgress {
  id: RecordSectionId;
  label: string;
  shortLabel: string;
  complete: boolean;
  skipped: boolean;
}

export interface TreatmentRecordProgress {
  sections: RecordSectionProgress[];
  completedCount: number;
  totalCount: number;
  isIncomplete: boolean;
}

export interface TreatmentWorkspaceStatusView {
  kind: TreatmentWorkspaceStatusKind;
  title: string;
  detail: string;
}

export interface TreatmentWorkspaceItem {
  id: string;
  kind: TreatmentRowKind;
  draft: TreatmentDraft | null;
  appointment: ScheduleAppointment | null;
  appointmentId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  customerName: string;
  customerPhone: string;
  customerInitials: string;
  membership: { id: "vip" | "new"; label: string } | null;
  serviceName: string;
  serviceCategory: string;
  serviceType: string | undefined;
  durationMinutes: number | null;
  staffName: string;
  staffInitials: string;
  startAt: string | null;
  endAt: string | null;
  locationId: string | undefined;
  appointmentStatus: CanonicalAppointmentStatus | undefined;
  record: TreatmentRecordProgress;
  status: TreatmentWorkspaceStatusView;
}

export interface TreatmentWorkspaceSummary {
  today: number;
  inProgress: number;
  incompleteRecords: number;
  completedToday: number;
}

export interface LastTreatmentView {
  dateLabel: string;
  serviceName: string;
  durationLabel: string | null;
  note: string | null;
}

export type TreatmentPrimaryCta =
  | { kind: "continue"; href: string; label: string }
  | { kind: "complete_record"; href: string; label: string }
  | { kind: "view"; href: string; label: string };

export type TreatmentOpenEmptyState =
  | { kind: "search" }
  | { kind: "no_completed" }
  | {
      kind: "next_appointment";
      startLabel: string;
      customerName: string;
      serviceName: string;
    }
  | { kind: "all_clear" }
  | { kind: "generic" };

const MUTED_APPOINTMENT_STATUSES = new Set<CanonicalAppointmentStatus>([
  "CANCELLED",
  "NO_SHOW",
  "DRAFT",
]);

const OPEN_APPOINTMENT_STATUSES = new Set<CanonicalAppointmentStatus>([
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "IN_SERVICE",
]);

export function treatmentWorkspaceHref(input: {
  customerId: string;
  appointmentId: string;
}): string {
  return `/staff/treatments/new?customer=${input.customerId}&appointment=${input.appointmentId}`;
}

export function completedTreatmentHref(treatmentId: string): string {
  return `/staff/treatments/${treatmentId}`;
}

export function recordSectionHref(input: {
  customerId: string;
  appointmentId: string;
  completed: boolean;
  treatmentId?: string;
}): string {
  if (input.completed && input.treatmentId) {
    return completedTreatmentHref(input.treatmentId);
  }
  return treatmentWorkspaceHref(input);
}

/** Content-based — ignores “current step” so the checklist stays honest. */
export function isRecordSectionComplete(
  draft: TreatmentDraft,
  step: RecordSectionId,
): boolean {
  if (draft.skippedSteps.includes(step)) return true;
  const state = getStepCompletionState(
    { ...draft, currentStep: "complete" },
    step as TreatmentStepId,
  );
  return state === "complete" || state === "skipped";
}

export function deriveRecordProgress(
  draft: TreatmentDraft | null,
): TreatmentRecordProgress {
  const sections: RecordSectionProgress[] = RECORD_SECTIONS.map((section) => {
    if (!draft) {
      return {
        id: section.id,
        label: section.label,
        shortLabel: section.shortLabel,
        complete: false,
        skipped: false,
      };
    }
    return {
      id: section.id,
      label: section.label,
      shortLabel: section.shortLabel,
      complete: isRecordSectionComplete(draft, section.id),
      skipped: draft.skippedSteps.includes(section.id),
    };
  });
  const completedCount = sections.filter((item) => item.complete).length;
  return {
    sections,
    completedCount,
    totalCount: sections.length,
    isIncomplete: completedCount < sections.length,
  };
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function itemOccursOn(item: {
  startAt: string | null;
  draftUpdatedAt?: string;
}): Date | null {
  return parseInstant(item.startAt) ?? parseInstant(item.draftUpdatedAt ?? null);
}

export function matchesDateFilter(
  when: Date | null,
  filter: TreatmentDateFilter,
  now: Date,
): boolean {
  if (filter === "all") return true;
  if (!when) return false;
  if (filter === "today") return localDayKey(when) === localDayKey(now);
  const from = startOfLocalDay(now);
  from.setDate(from.getDate() - 6);
  const point = startOfLocalDay(when);
  return point.getTime() >= from.getTime() && point.getTime() <= startOfLocalDay(now).getTime();
}

function formatElapsed(minutes: number): string {
  const abs = Math.max(0, Math.round(minutes));
  if (abs < 60) return `${abs} 分鐘`;
  const hours = Math.floor(abs / 60);
  const rem = abs % 60;
  if (rem === 0) return `${hours} 小時`;
  return `${hours} 小時 ${rem} 分鐘`;
}

export function deriveTreatmentStatus(input: {
  kind: TreatmentRowKind;
  appointmentStatus?: CanonicalAppointmentStatus;
  startAt: string | null;
  endAt: string | null;
  recordIncomplete: boolean;
  now: Date;
}): TreatmentWorkspaceStatusView {
  const start = parseInstant(input.startAt);
  const end = parseInstant(input.endAt);

  if (input.kind === "completed") {
    const doneAt = end ?? start;
    return {
      kind: "completed",
      title: "已完成",
      detail: doneAt ? `${formatHm(doneAt)} 完成` : "療程已完成",
    };
  }

  if (input.appointmentStatus === "IN_SERVICE") {
    if (start && start.getTime() > input.now.getTime()) {
      return {
        kind: "in_progress",
        title: "進行中",
        detail: "服務中",
      };
    }
    const elapsed = start
      ? Math.max(0, Math.floor((input.now.getTime() - start.getTime()) / 60_000))
      : 0;
    return {
      kind: "in_progress",
      title: "進行中",
      detail: start ? `已進行 ${formatElapsed(elapsed)}` : "服務中",
    };
  }

  if (
    input.appointmentStatus === "COMPLETED" ||
    (end && end.getTime() <= input.now.getTime() && input.recordIncomplete)
  ) {
    return {
      kind: "record_incomplete",
      title: "紀錄待完成",
      detail: "請補充療程紀錄",
    };
  }

  if (start && start.getTime() > input.now.getTime()) {
    const remains = Math.max(
      0,
      Math.round((start.getTime() - input.now.getTime()) / 60_000),
    );
    return {
      kind: "not_started",
      title: "未開始",
      detail: `還有 ${formatElapsed(remains)}`,
    };
  }

  if (start && (!end || end.getTime() > input.now.getTime())) {
    const elapsed = Math.max(
      0,
      Math.floor((input.now.getTime() - start.getTime()) / 60_000),
    );
    return {
      kind: "in_progress",
      title: "進行中",
      detail: `已進行 ${formatElapsed(elapsed)}`,
    };
  }

  if (input.recordIncomplete) {
    return {
      kind: "record_incomplete",
      title: "紀錄待完成",
      detail: "請補充療程紀錄",
    };
  }

  return {
    kind: "not_started",
    title: "未開始",
    detail: "尚未開始服務",
  };
}

function initialsFrom(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "—";
}

function lookupCustomer(
  customers: Customer[],
  customerId: string,
): Customer | undefined {
  return customers.find((item) => item.id === customerId);
}

function lookupService(
  catalog: TreatmentCatalogHint[],
  serviceId: string,
): TreatmentCatalogHint | undefined {
  return catalog.find((item) => item.id === serviceId);
}

export function treatmentRowId(input: {
  kind: TreatmentRowKind;
  draftId?: string;
  appointmentId?: string;
}): string {
  if (input.kind === "completed" && input.draftId) {
    return `completed:${input.draftId}`;
  }
  if (input.kind === "draft" && input.draftId) {
    return `draft:${input.draftId}`;
  }
  return `appointment:${input.appointmentId ?? "unknown"}`;
}

function toItem(input: {
  kind: TreatmentRowKind;
  draft: TreatmentDraft | null;
  appointment: ScheduleAppointment | null;
  customers: Customer[];
  catalog: TreatmentCatalogHint[];
  staffNames: Record<string, string>;
  now: Date;
}): TreatmentWorkspaceItem {
  const draft = input.draft;
  const appointment = input.appointment;
  const customerId = draft?.customerId ?? appointment?.customerId ?? "";
  const serviceId = draft?.serviceId ?? appointment?.serviceId ?? "";
  const staffId = draft?.staffId ?? appointment?.staffId ?? "";
  const customer = lookupCustomer(input.customers, customerId);
  const service = lookupService(input.catalog, serviceId);
  const staffName =
    appointment?.staffName ||
    input.staffNames[staffId] ||
    staffId;
  const customerName = customer?.name || appointment?.customerName || customerId;
  const record = deriveRecordProgress(draft);
  const startAt = appointment?.startAt ?? draft?.createdAt ?? null;
  const endAt = appointment?.endAt ?? draft?.updatedAt ?? null;
  const kind = input.kind;
  const status = deriveTreatmentStatus({
    kind,
    appointmentStatus: appointment?.status,
    startAt,
    endAt,
    recordIncomplete: kind !== "completed" && (record.isIncomplete || !draft),
    now: input.now,
  });

  return {
    id: treatmentRowId({
      kind,
      draftId: draft?.id,
      appointmentId: appointment?.id ?? draft?.appointmentId,
    }),
    kind,
    draft,
    appointment,
    appointmentId: appointment?.id ?? draft?.appointmentId ?? "",
    customerId,
    serviceId,
    staffId,
    customerName,
    customerPhone: customer?.phone ?? "",
    customerInitials: initialsFrom(customerName),
    membership: customer
      ? membershipBadge(customer)
      : appointment?.membership === "vip"
        ? { id: "vip", label: "VIP" }
        : appointment?.membership === "new"
          ? { id: "new", label: "新客" }
          : null,
    serviceName: service?.name || appointment?.serviceName || serviceId,
    serviceCategory: service?.category ?? "",
    serviceType: service?.serviceType,
    durationMinutes:
      service?.durationMinutes ??
      appointment?.durationMinutes ??
      null,
    staffName,
    staffInitials: initialsFrom(staffName),
    startAt,
    endAt,
    locationId: draft?.locationId ?? appointment?.locationId,
    appointmentStatus: appointment?.status,
    record,
    status,
  };
}

export function buildTreatmentWorkspaceItems(input: {
  openDrafts: TreatmentDraft[];
  completedTreatments: TreatmentDraft[];
  appointments: ScheduleAppointment[];
  customers: Customer[];
  catalog: TreatmentCatalogHint[];
  staffNames?: Record<string, string>;
  locationId?: string;
  now: Date;
}): TreatmentWorkspaceItem[] {
  const staffNames = input.staffNames ?? {};
  const byAppointment = new Map<string, TreatmentWorkspaceItem>();
  const extras: TreatmentWorkspaceItem[] = [];

  const locationOk = (locationId: string | undefined) =>
    !input.locationId || !locationId || locationId === input.locationId;

  const completedByAppointment = new Map<string, TreatmentDraft>();
  for (const draft of input.completedTreatments) {
    if (!locationOk(draft.locationId)) continue;
    if (draft.appointmentId) completedByAppointment.set(draft.appointmentId, draft);
  }

  const openByAppointment = new Map<string, TreatmentDraft>();
  for (const draft of input.openDrafts) {
    if (!locationOk(draft.locationId)) continue;
    if (draft.appointmentId) openByAppointment.set(draft.appointmentId, draft);
  }

  for (const draft of input.completedTreatments) {
    if (!locationOk(draft.locationId)) continue;
    const appointment = input.appointments.find(
      (item) => item.id === draft.appointmentId,
    );
    const item = toItem({
      kind: "completed",
      draft,
      appointment: appointment ?? null,
      customers: input.customers,
      catalog: input.catalog,
      staffNames,
      now: input.now,
    });
    if (draft.appointmentId) byAppointment.set(draft.appointmentId, item);
    else extras.push(item);
  }

  for (const draft of input.openDrafts) {
    if (!locationOk(draft.locationId)) continue;
    if (draft.appointmentId && byAppointment.has(draft.appointmentId)) continue;
    const appointment = input.appointments.find(
      (item) => item.id === draft.appointmentId,
    );
    const item = toItem({
      kind: "draft",
      draft,
      appointment: appointment ?? null,
      customers: input.customers,
      catalog: input.catalog,
      staffNames,
      now: input.now,
    });
    if (draft.appointmentId) byAppointment.set(draft.appointmentId, item);
    else extras.push(item);
  }

  for (const appointment of input.appointments) {
    if (!locationOk(appointment.locationId)) continue;
    if (byAppointment.has(appointment.id)) continue;
    if (MUTED_APPOINTMENT_STATUSES.has(appointment.status)) continue;
    const item = toItem({
      kind: "appointment",
      draft: null,
      appointment,
      customers: input.customers,
      catalog: input.catalog,
      staffNames,
      now: input.now,
    });
    byAppointment.set(appointment.id, item);
  }

  void completedByAppointment;
  void openByAppointment;

  const items = [...byAppointment.values(), ...extras];
  return items.sort((a, b) => {
    const aTime = a.startAt ?? a.draft?.updatedAt ?? "";
    const bTime = b.startAt ?? b.draft?.updatedAt ?? "";
    return aTime.localeCompare(bTime);
  });
}

export function itemMatchesOpenFilter(item: TreatmentWorkspaceItem): boolean {
  if (item.kind === "completed") return false;
  if (item.kind === "draft") return true;
  if (item.status.kind === "record_incomplete") return true;
  if (item.status.kind === "in_progress") return true;
  if (
    item.appointmentStatus &&
    OPEN_APPOINTMENT_STATUSES.has(item.appointmentStatus)
  ) {
    return true;
  }
  return item.status.kind === "not_started";
}

export function filterTreatmentItems(
  items: TreatmentWorkspaceItem[],
  filter: TreatmentListFilter,
  query: string,
  dateFilter: TreatmentDateFilter,
  now: Date,
): TreatmentWorkspaceItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === "open" && !itemMatchesOpenFilter(item)) return false;
    if (filter === "completed" && item.kind !== "completed") return false;
    const when = itemOccursOn({
      startAt: item.startAt,
      draftUpdatedAt: item.draft?.updatedAt,
    });
    if (!matchesDateFilter(when, dateFilter, now)) return false;
    if (!q) return true;
    return (
      item.customerName.toLowerCase().includes(q) ||
      item.serviceName.toLowerCase().includes(q) ||
      item.staffName.toLowerCase().includes(q)
    );
  });
}

export function countTreatmentWorkspaceSummary(
  items: TreatmentWorkspaceItem[],
  now: Date,
): TreatmentWorkspaceSummary {
  const todayItems = items.filter((item) => {
    const when = itemOccursOn({
      startAt: item.startAt,
      draftUpdatedAt: item.draft?.updatedAt,
    });
    return when ? localDayKey(when) === localDayKey(now) : false;
  });

  const todayActive = todayItems.filter(
    (item) =>
      item.kind === "completed" ||
      !item.appointmentStatus ||
      !MUTED_APPOINTMENT_STATUSES.has(item.appointmentStatus),
  );

  const inProgress = items.filter((item) => item.status.kind === "in_progress");
  const incompleteRecords = items.filter(
    (item) => item.status.kind === "record_incomplete",
  );
  const completedToday = todayItems.filter((item) => item.kind === "completed");

  const todayIds = new Set(todayActive.map((item) => item.id));
  return {
    today: todayIds.size,
    inProgress: inProgress.length,
    incompleteRecords: incompleteRecords.length,
    completedToday: completedToday.length,
  };
}

export function deriveLastCompletedTreatment(input: {
  completedTreatments: TreatmentDraft[];
  customerId: string;
  catalog: TreatmentCatalogHint[];
  excludeAppointmentId?: string;
  excludeTreatmentId?: string;
}): LastTreatmentView | null {
  const history = input.completedTreatments
    .filter((item) => item.customerId === input.customerId)
    .filter((item) => item.id !== input.excludeTreatmentId)
    .filter((item) =>
      input.excludeAppointmentId
        ? item.appointmentId !== input.excludeAppointmentId
        : true,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latest = history[0];
  if (!latest) return null;
  const when = parseInstant(latest.updatedAt) ?? parseInstant(latest.createdAt);
  const service = lookupService(input.catalog, latest.serviceId);
  const note = latest.professionalNote.trim() || latest.followUp.note.trim() || null;
  return {
    dateLabel: when ? formatSlashDate(when) : latest.updatedAt,
    serviceName: service?.name || latest.serviceId,
    durationLabel: service?.durationMinutes
      ? `${service.durationMinutes} 分鐘`
      : null,
    note,
  };
}

export function collectTreatmentAttentionNotes(input: {
  customer?: Customer | null;
  appointmentNotes?: string[];
  appointmentCustomerNote?: string;
  currentDraft?: TreatmentDraft | null;
  latestCompleted?: TreatmentDraft | null;
}): string[] {
  const extras: Array<string | null | undefined> = [];
  for (const note of input.appointmentNotes ?? []) {
    extras.push(formatReminderTag(note));
  }
  extras.push(input.appointmentCustomerNote);
  const draft = input.currentDraft;
  if (draft) {
    extras.push(draft.professionalNote, draft.bodyMapNote, draft.followUp.note);
    extras.push(...draft.followUp.tags);
    extras.push(draft.discomfortNote);
  }
  const latest = input.latestCompleted;
  if (latest && latest.id !== draft?.id) {
    extras.push(latest.professionalNote, latest.followUp.note);
    extras.push(...latest.followUp.tags);
  }
  if (input.customer) {
    return collectCustomerAttentionNotes(input.customer, extras);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of extras) {
    const text = raw?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.slice(0, 6);
}

export function deriveTreatmentPrimaryCta(
  item: TreatmentWorkspaceItem,
): TreatmentPrimaryCta {
  if (item.kind === "completed" && item.draft) {
    return {
      kind: "view",
      href: completedTreatmentHref(item.draft.id),
      label: "查看完整療程",
    };
  }
  const href = treatmentWorkspaceHref({
    customerId: item.customerId,
    appointmentId: item.appointmentId,
  });
  if (item.status.kind === "record_incomplete") {
    return { kind: "complete_record", href, label: "完成療程紀錄" };
  }
  return { kind: "continue", href, label: "繼續療程紀錄" };
}

export function shouldShowCheckoutCta(
  nav: AppointmentCheckoutNav | { kind: "none" },
): boolean {
  return nav.kind === "checkout";
}

export function resolveSelectedTreatment(
  items: TreatmentWorkspaceItem[],
  selectedId: string | null,
): TreatmentWorkspaceItem | null {
  if (!selectedId) return null;
  return items.find((item) => item.id === selectedId) ?? null;
}

export function shouldResetTreatmentSelection(input: {
  selectedId: string | null;
  visibleItems: TreatmentWorkspaceItem[];
}): boolean {
  if (!input.selectedId) return false;
  return !input.visibleItems.some((item) => item.id === input.selectedId);
}

export function shouldRenderTreatmentQuickView(
  selected: TreatmentWorkspaceItem | null,
): boolean {
  return selected !== null;
}

export function isInlineTreatmentQuickViewViewport(widthPx: number): boolean {
  return widthPx >= TREATMENT_INLINE_QUICKVIEW_MIN_PX;
}

export function treatmentListPresentation(
  widthPx: number,
): "desktop-rows" | "mobile-cards" {
  return isInlineTreatmentQuickViewViewport(widthPx)
    ? "desktop-rows"
    : "mobile-cards";
}

export function isTreatmentRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function treatmentServiceTint(serviceType: string | undefined) {
  return serviceTypeCardTone(serviceType);
}

export function formatAppointmentRange(
  startAt: string | null,
  endAt: string | null,
): string | null {
  const start = parseInstant(startAt);
  const end = parseInstant(endAt);
  if (!start) return null;
  const date = formatSlashDate(start);
  if (!end) return `${date} ${formatHm(start)}`;
  return `${date} ${formatHm(start)}–${formatHm(end)}`;
}

export function nextUpcomingAppointment(
  appointments: ScheduleAppointment[],
  now: Date,
): ScheduleAppointment | null {
  const upcoming = appointments
    .filter((item) => !MUTED_APPOINTMENT_STATUSES.has(item.status))
    .filter((item) => {
      const start = parseInstant(item.startAt);
      return start !== null && start.getTime() > now.getTime();
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  return upcoming[0] ?? null;
}

export function deriveTreatmentEmptyState(input: {
  visibleCount: number;
  query: string;
  filter: TreatmentListFilter;
  todayAppointments: ScheduleAppointment[];
  now: Date;
}): TreatmentOpenEmptyState | null {
  if (input.visibleCount > 0) return null;
  if (input.query.trim()) return { kind: "search" };
  if (input.filter === "completed") return { kind: "no_completed" };
  const next = nextUpcomingAppointment(input.todayAppointments, input.now);
  if (next) {
    const start = parseInstant(next.startAt);
    return {
      kind: "next_appointment",
      startLabel: start ? formatHm(start) : "",
      customerName: next.customerName,
      serviceName: next.serviceName,
    };
  }
  if (input.filter === "open") return { kind: "all_clear" };
  return { kind: "generic" };
}

export function visitCountLabel(totalVisits: number | undefined): string | null {
  if (!totalVisits || totalVisits <= 0) return null;
  return `第 ${totalVisits} 次來店`;
}
