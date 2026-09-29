/**
 * Follow-up Workspace — presentation helpers only.
 * Source of truth remains FollowUpTask in lib/follow-ups/store.
 * No store, mutation, duplicate domain, or persisted summary.
 */
import {
  formatHm,
  startOfDay,
} from "@/lib/appointments/domain";
import {
  FOLLOW_UP_STATUS_LABEL,
  FOLLOW_UP_TYPE_LABEL,
  type FollowUpTask,
  type FollowUpTaskStatus,
  type FollowUpTaskType,
} from "@/lib/follow-ups/domain";
import {
  listCompletedFollowUps,
  listDueTodayFollowUps,
  listOpenFollowUps,
  listOverdueFollowUps,
  listUpcomingFollowUps,
} from "@/lib/follow-ups/selectors";
import { normalizePhone } from "@/lib/phone";

export const FOLLOW_UPS_PANEL_WIDTH_PX = 400;
export const FOLLOW_UPS_INLINE_MIN_PX = 1200;
export const FOLLOW_UPS_WORKSPACE_GAP_PX = 16;

export const FOLLOW_UPS_HAS_CONTACT_HISTORY = false;
export const FOLLOW_UPS_HAS_SECOND_STORE = false;
export const FOLLOW_UPS_HAS_ACTIVITY_MODEL = false;
export const FOLLOW_UPS_HAS_CONTACTED_STATUS = false;

export type FollowUpTimeFilter =
  | "today"
  | "overdue"
  | "upcoming"
  | "mine"
  | "completed"
  | "all";

export type FollowUpTypeFilter = "all" | FollowUpTaskType;

export type FollowUpDueKind = "today" | "overdue" | "upcoming" | "completed";

export const FOLLOW_UP_TIME_FILTER_OPTIONS: Array<{
  id: FollowUpTimeFilter;
  label: string;
}> = [
  { id: "today", label: "今天" },
  { id: "overdue", label: "逾期" },
  { id: "upcoming", label: "即將到期" },
  { id: "mine", label: "我的追蹤" },
  { id: "completed", label: "已完成" },
  { id: "all", label: "全部" },
];

export const FOLLOW_UP_TYPE_FILTER_OPTIONS: Array<{
  id: FollowUpTypeFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "TREATMENT_FOLLOW_UP", label: FOLLOW_UP_TYPE_LABEL.TREATMENT_FOLLOW_UP },
  { id: "REBOOKING", label: FOLLOW_UP_TYPE_LABEL.REBOOKING },
];

export interface FollowUpCustomerHint {
  id: string;
  organizationId: string;
  name: string;
  phone: string;
  tags: Array<{ id: string; label: string }>;
}

export interface FollowUpStaffHint {
  userId: string;
  displayName: string;
}

export interface FollowUpLocationHint {
  id: string;
  name: string;
}

export interface FollowUpTreatmentHint {
  id: string;
  organizationId: string;
  serviceName?: string;
  dateIso?: string;
  professionalNote?: string;
}

export interface FollowUpAppointmentHint {
  id: string;
  organizationId: string;
  serviceName: string;
  startAt: string;
  statusLabel: string;
}

export interface FollowUpRelatedTreatmentView {
  treatmentId: string;
  serviceName: string;
  dateLabel: string;
  professionalNote: string | null;
}

export interface FollowUpRelatedAppointmentView {
  appointmentId: string;
  serviceName: string;
  dateLabel: string;
  statusLabel: string;
}

export interface FollowUpWorkspaceTagView {
  id: string;
  label: string;
}

export interface FollowUpWorkspaceRow {
  taskId: string;
  organizationId: string;
  locationId?: string;
  locationName: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerInitials: string;
  customerTags: FollowUpWorkspaceTagView[];
  title: string;
  reason: string;
  type: FollowUpTaskType;
  typeLabel: string;
  dueAt: string;
  dueLabel: string;
  dueTimeLabel: string;
  assignedStaffId?: string;
  ownerLabel: string;
  status: FollowUpTaskStatus;
  statusLabel: string;
  dueKind: FollowUpDueKind;
  overdueDays: number | null;
  overdueLabel: string | null;
  serviceName: string;
  treatmentId?: string;
  appointmentId?: string;
  note?: string;
  completionNote?: string;
  followUpTags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  createdLabel: string;
  updatedLabel: string;
  completedLabel: string;
  relatedTreatment: FollowUpRelatedTreatmentView | null;
  relatedAppointment: FollowUpRelatedAppointmentView | null;
}

export interface FollowUpWorkspaceSummary {
  todayCount: number;
  overdueCount: number;
  upcomingCount: number;
  completedThisWeekCount: number;
}

/** Monday-start local week containing `now` (same convention as reports). */
export function startOfLocalWeekMonday(now: Date): Date {
  const todayStart = startOfDay(now);
  const day = todayStart.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() + diff);
  return startOfDay(weekStart);
}

export function endOfLocalWeekSunday(now: Date): Date {
  const start = startOfLocalWeekMonday(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function deriveOverdueDays(dueAt: string, now: Date): number {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 0;
  const dueStart = startOfDay(due).getTime();
  const todayStart = startOfDay(now).getTime();
  return Math.max(0, Math.round((todayStart - dueStart) / 86_400_000));
}

export function formatFollowUpDueLabel(iso: string): {
  dueLabel: string;
  dueTimeLabel: string;
} {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { dueLabel: iso, dueTimeLabel: "" };
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const time = formatHm(date);
  return {
    dueLabel: `${month}/${day} ${time}`,
    dueTimeLabel: time,
  };
}

export function formatFollowUpTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day} ${formatHm(date)}`;
}

export function deriveFollowUpDueKind(
  task: FollowUpTask,
  now: Date,
): FollowUpDueKind {
  if (task.status === "COMPLETED") return "completed";
  const today = listDueTodayFollowUps([task], now);
  if (today.length > 0) return "today";
  const overdue = listOverdueFollowUps([task], now);
  if (overdue.length > 0) return "overdue";
  return "upcoming";
}

export function followUpInitials(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "客";
}

export function followUpTitle(task: FollowUpTask): string {
  const note = task.note?.trim();
  if (note) return note;
  return FOLLOW_UP_TYPE_LABEL[task.type];
}

export function followUpReason(task: FollowUpTask): string {
  if (task.context.followUpTags.length > 0) {
    return task.context.followUpTags.join("、");
  }
  return task.context.serviceName?.trim() || "";
}

export function listCompletedThisWeekFollowUps(
  tasks: FollowUpTask[],
  now: Date = new Date(),
): FollowUpTask[] {
  const start = startOfLocalWeekMonday(now).getTime();
  const end = endOfLocalWeekSunday(now).getTime();
  return listCompletedFollowUps(tasks).filter((task) => {
    if (!task.completedAt) return false;
    const stamp = new Date(task.completedAt).getTime();
    if (Number.isNaN(stamp)) return false;
    return stamp >= start && stamp <= end;
  });
}

export function countFollowUpWorkspaceSummary(
  tasks: FollowUpTask[],
  now: Date = new Date(),
): FollowUpWorkspaceSummary {
  return {
    todayCount: listDueTodayFollowUps(tasks, now).length,
    overdueCount: listOverdueFollowUps(tasks, now).length,
    upcomingCount: listUpcomingFollowUps(tasks, now).length,
    completedThisWeekCount: listCompletedThisWeekFollowUps(tasks, now).length,
  };
}

export function listFollowUpsForTimeFilter(
  tasks: FollowUpTask[],
  filter: FollowUpTimeFilter,
  input: { now: Date; staffId?: string },
): FollowUpTask[] {
  switch (filter) {
    case "today":
      return listDueTodayFollowUps(tasks, input.now);
    case "overdue":
      return listOverdueFollowUps(tasks, input.now);
    case "upcoming":
      return listUpcomingFollowUps(tasks, input.now);
    case "mine":
      if (!input.staffId) return [];
      return listOpenFollowUps(tasks).filter(
        (task) => task.assignedStaffId === input.staffId,
      );
    case "completed":
      return listCompletedFollowUps(tasks);
    case "all":
    default:
      return [...tasks].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }
}

export function matchesFollowUpSearch(
  row: FollowUpWorkspaceRow,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.customerName.toLowerCase().includes(q)) return true;
  const phoneQ = normalizePhone(q);
  if (phoneQ && normalizePhone(row.customerPhone).includes(phoneQ)) return true;
  if (row.title.toLowerCase().includes(q)) return true;
  if (row.reason.toLowerCase().includes(q)) return true;
  if (row.note?.toLowerCase().includes(q)) return true;
  if (row.serviceName.toLowerCase().includes(q)) return true;
  if (row.typeLabel.toLowerCase().includes(q)) return true;
  return false;
}

export function filterFollowUpRows(
  rows: FollowUpWorkspaceRow[],
  input: {
    type: FollowUpTypeFilter;
    query: string;
  },
): FollowUpWorkspaceRow[] {
  return rows.filter((row) => {
    if (input.type !== "all" && row.type !== input.type) return false;
    return matchesFollowUpSearch(row, input.query);
  });
}

export function buildFollowUpWorkspaceRows(input: {
  tasks: FollowUpTask[];
  organizationId: string;
  customers: FollowUpCustomerHint[];
  locations?: FollowUpLocationHint[];
  staff?: FollowUpStaffHint[];
  treatments?: FollowUpTreatmentHint[];
  appointments?: FollowUpAppointmentHint[];
  now: Date;
}): FollowUpWorkspaceRow[] {
  const customersById = new Map(
    input.customers
      .filter((customer) => customer.organizationId === input.organizationId)
      .map((customer) => [customer.id, customer]),
  );
  const locationsById = new Map(
    (input.locations ?? []).map((location) => [location.id, location]),
  );
  const staffById = new Map(
    (input.staff ?? []).map((member) => [member.userId, member]),
  );
  const treatmentsById = new Map(
    (input.treatments ?? [])
      .filter((treatment) => treatment.organizationId === input.organizationId)
      .map((treatment) => [treatment.id, treatment]),
  );
  const appointmentsById = new Map(
    (input.appointments ?? [])
      .filter((appointment) => appointment.organizationId === input.organizationId)
      .map((appointment) => [appointment.id, appointment]),
  );

  return input.tasks
    .filter((task) => task.organizationId === input.organizationId)
    .map((task) => {
      const customer = customersById.get(task.customerId);
      const customerName =
        customer?.name.trim() || task.context.customerName?.trim() || task.customerId;
      const dueKind = deriveFollowUpDueKind(task, input.now);
      const overdueDays =
        dueKind === "overdue" ? deriveOverdueDays(task.dueAt, input.now) : null;
      const due = formatFollowUpDueLabel(task.dueAt);
      const owner =
        (task.assignedStaffId
          ? staffById.get(task.assignedStaffId)?.displayName
          : undefined) ||
        task.context.staffName ||
        "未指派";
      const treatmentLookupId = task.treatmentId ?? task.sourceTreatmentId;
      const treatment = treatmentLookupId
        ? treatmentsById.get(treatmentLookupId)
        : undefined;
      const appointment = task.appointmentId
        ? appointmentsById.get(task.appointmentId)
        : undefined;
      const hasTreatmentContext = Boolean(
        treatmentLookupId &&
          (treatment ||
            task.context.serviceName?.trim() ||
            task.context.treatmentNote?.trim()),
      );

      return {
        taskId: task.id,
        organizationId: task.organizationId,
        locationId: task.locationId,
        locationName: task.locationId
          ? locationsById.get(task.locationId)?.name ?? ""
          : "",
        customerId: task.customerId,
        customerName,
        customerPhone: customer?.phone ?? "",
        customerInitials: followUpInitials(customerName),
        customerTags: (customer?.tags ?? []).map((tag) => ({
          id: tag.id,
          label: tag.label,
        })),
        title: followUpTitle(task),
        reason: followUpReason(task),
        type: task.type,
        typeLabel: FOLLOW_UP_TYPE_LABEL[task.type],
        dueAt: task.dueAt,
        dueLabel: due.dueLabel,
        dueTimeLabel: due.dueTimeLabel,
        assignedStaffId: task.assignedStaffId,
        ownerLabel: owner,
        status: task.status,
        statusLabel: FOLLOW_UP_STATUS_LABEL[task.status],
        dueKind,
        overdueDays,
        overdueLabel:
          overdueDays && overdueDays > 0 ? `逾期 ${overdueDays} 天` : null,
        serviceName: task.context.serviceName ?? "",
        treatmentId: task.treatmentId,
        appointmentId: task.appointmentId,
        note: task.note,
        completionNote: task.completionNote,
        followUpTags: [...task.context.followUpTags],
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
        createdLabel: formatFollowUpTimestamp(task.createdAt),
        updatedLabel: formatFollowUpTimestamp(task.updatedAt),
        completedLabel: formatFollowUpTimestamp(task.completedAt),
        relatedTreatment: hasTreatmentContext
          ? {
              treatmentId: treatmentLookupId as string,
              serviceName:
                treatment?.serviceName || task.context.serviceName || "",
              dateLabel: formatFollowUpTimestamp(treatment?.dateIso),
              professionalNote:
                treatment?.professionalNote?.trim() ||
                task.context.treatmentNote?.trim() ||
                null,
            }
          : null,
        relatedAppointment: task.appointmentId
          ? {
              appointmentId: task.appointmentId,
              serviceName: appointment?.serviceName || "",
              dateLabel: formatFollowUpTimestamp(appointment?.startAt),
              statusLabel: appointment?.statusLabel || "",
            }
          : null,
      };
    });
}

export function sortFollowUpWorkspaceRows(
  rows: FollowUpWorkspaceRow[],
  filter: FollowUpTimeFilter,
): FollowUpWorkspaceRow[] {
  const copy = [...rows];
  if (filter === "completed") {
    return copy.sort((a, b) =>
      (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt),
    );
  }
  return copy.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function resolveSelectedFollowUpRow(
  rows: FollowUpWorkspaceRow[],
  selectedFollowUpId: string | null,
): FollowUpWorkspaceRow | null {
  if (!selectedFollowUpId) return null;
  return rows.find((row) => row.taskId === selectedFollowUpId) ?? null;
}

export function shouldResetFollowUpSelection(input: {
  selectedFollowUpId: string | null;
  visibleRows: FollowUpWorkspaceRow[];
}): boolean {
  if (!input.selectedFollowUpId) return false;
  return !input.visibleRows.some((row) => row.taskId === input.selectedFollowUpId);
}

export function shouldRenderFollowUpQuickView(
  selected: FollowUpWorkspaceRow | null,
): boolean {
  return selected !== null;
}

export function isInlineFollowUpQuickViewViewport(widthPx: number): boolean {
  return widthPx >= FOLLOW_UPS_INLINE_MIN_PX;
}

export function followUpListPresentation(
  widthPx: number,
): "desktop-rows" | "mobile-cards" {
  return isInlineFollowUpQuickViewViewport(widthPx)
    ? "desktop-rows"
    : "mobile-cards";
}

export function isFollowUpRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function isTodayFollowUpEmptyState(input: {
  timeFilter: FollowUpTimeFilter;
  typeFilter: FollowUpTypeFilter;
  query: string;
}): boolean {
  return (
    input.timeFilter === "today" &&
    input.typeFilter === "all" &&
    input.query.trim() === ""
  );
}

export function followUpEmptyCopy(input: {
  timeFilter: FollowUpTimeFilter;
  typeFilter: FollowUpTypeFilter;
  query: string;
}): {
  kind: "today" | "scope" | "filtered";
  title: string;
  subtext?: string;
  showClear: boolean;
} {
  const narrowed = input.typeFilter !== "all" || input.query.trim() !== "";
  if (narrowed) {
    return {
      kind: "filtered",
      title: "沒有符合條件的追蹤",
      showClear: true,
    };
  }
  if (input.timeFilter === "today") {
    return {
      kind: "today",
      title: "今天沒有需要追蹤的客人",
      subtext: "完成療程並設定下次追蹤後，任務會出現在這裡。",
      showClear: false,
    };
  }
  const scopeTitle: Record<FollowUpTimeFilter, string> = {
    today: "今天沒有需要追蹤的客人",
    overdue: "目前沒有逾期追蹤",
    upcoming: "目前沒有即將到期的追蹤",
    mine: "目前沒有指派給你的追蹤",
    completed: "目前沒有已完成的追蹤",
    all: "尚無追蹤紀錄",
  };
  return {
    kind: "scope",
    title: scopeTitle[input.timeFilter],
    showClear: input.timeFilter !== "all",
  };
}
