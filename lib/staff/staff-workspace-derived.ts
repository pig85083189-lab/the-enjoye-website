/**
 * Staff Workspace — presentation / derived read model only.
 * Source of truth remains StaffMembership + lib/staff-schedule store.
 * No second staff/schedule/availability store, no persisted summary fields.
 */
import {
  combineLocalDateTime,
  endOfDay,
  formatHm,
  formatYmd,
  startOfDay,
} from "@/lib/appointments/domain";
import {
  CALENDAR_DAY_END_HOUR,
  CALENDAR_DAY_START_HOUR,
} from "@/lib/appointments/calendar-config";
import {
  DAY_OF_WEEK_LABEL,
  parseHmToMinutes,
  type DayOfWeek,
  type StaffBreak,
  type StaffTimeOff,
  type StaffWorkingHours,
  type TimeOffStatus,
} from "@/lib/staff-schedule/domain";
import type { StaffMembership, StaffRole } from "@/types/saas";
import {
  deriveStaffInviteLifecycle,
  loginBindingFromLifecycle,
  pickLatestStaffInviteForMembership,
  type StaffInviteLifecycle,
} from "@/lib/staff-auth/staff-invite-visibility";

export const STAFF_WORKSPACE_PANEL_WIDTH_PX = 400;
export const STAFF_WORKSPACE_INLINE_MIN_PX = 1200;
export const STAFF_WORKSPACE_GAP_PX = 16;

export const STAFF_HAS_CREATE_FLOW = true;
export const STAFF_HAS_CALENDAR_STAFF_PREFILTER = false;
export const STAFF_HAS_SERVICE_CAPABILITY_STORE = false;
export const STAFF_HAS_SPLIT_SHIFTS = false;
export const STAFF_HAS_SECOND_SCHEDULE_STORE = false;
export const STAFF_HAS_SECOND_AVAILABILITY_CALCULATOR = false;
export const STAFF_HAS_EMAIL_PHONE = false;

export type StaffEmploymentFilter = "all" | "active" | "inactive";
export type StaffWorkspaceView = "staff" | "week";
export type StaffTodayStatus = "working" | "time_off" | "off" | "inactive";
export type StaffApplyHoursPattern = "mon-fri" | "mon-sat";

export const STAFF_EMPLOYMENT_FILTER_OPTIONS: Array<{
  id: StaffEmploymentFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "active", label: "在職" },
  { id: "inactive", label: "停用" },
];

export const STAFF_VIEW_OPTIONS: Array<{
  id: StaffWorkspaceView;
  label: string;
}> = [
  { id: "staff", label: "員工" },
  { id: "week", label: "本週排班" },
];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  STAFF: "STAFF",
  RECEPTIONIST: "RECEPTIONIST",
  ACCOUNTANT: "ACCOUNTANT",
};

export const STAFF_TODAY_STATUS_LABEL: Record<StaffTodayStatus, string> = {
  working: "上班中",
  time_off: "休假",
  off: "未排班",
  inactive: "停用",
};

export interface StaffTimeSegment {
  kind: "working" | "time_off";
  startHm: string;
  endHm: string;
  label: string;
}

export interface StaffDayCell {
  ymd: string;
  dayOfWeek: DayOfWeek;
  kind: "working" | "time_off" | "off" | "unset" | "mixed";
  segments: StaffTimeSegment[];
  compactLabel: string;
  scheduledMinutes: number;
  timeOffMinutes: number;
}

export interface StaffWeekStats {
  staffId: string;
  scheduledDays: number;
  timeOffDays: number;
  scheduledMinutes: number;
}

export interface StaffWorkspaceRow {
  staffId: string;
  membershipId: string;
  organizationId: string;
  displayName: string;
  initials: string;
  role: StaffRole;
  roleLabel: string;
  title: string | null;
  loginBinding: "bound" | "unbound" | "pending";
  inviteLifecycle: StaffInviteLifecycle;
  email: string | null;
  authUserId: string | null;
  locationIds: string[];
  locationLabel: string;
  isActive: boolean;
  employmentLabel: "在職" | "停用";
  todayStatus: StaffTodayStatus;
  todayStatusLabel: string;
  todayHoursLabel: string;
  todayWorkStartHm: string | null;
  todayWorkEndHm: string | null;
  todayBreaks: Array<{ id: string; label: string; rangeLabel: string }>;
  searchText: string;
}

export interface StaffWorkspaceSummary {
  activeCount: number;
  inactiveCount: number;
  todayWorkingCount: number;
  todayTimeOffCount: number;
  weeklyScheduledMinutes: number;
  weeklyAverageMinutes: number;
  todayWorkingRate: number;
  todayTimeOffRate: number;
}

export interface StaffWeekColumn {
  date: Date;
  ymd: string;
  dayOfWeek: DayOfWeek;
  headerLabel: string;
}

export interface StaffWeekGridRow {
  staffId: string;
  displayName: string;
  cells: StaffDayCell[];
  stats: StaffWeekStats;
}

export interface UpcomingTimeOffView {
  id: string;
  staffId: string;
  startAt: string;
  endAt: string;
  dateLabel: string;
  timeLabel: string;
  reason?: string;
  status: TimeOffStatus;
  isFullDay: boolean;
}

export interface StaffApplyHoursDraft {
  locationId: string;
  staffId: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  isWorking: boolean;
}

export interface StaffWorkspaceModel {
  rows: StaffWorkspaceRow[];
  summary: StaffWorkspaceSummary;
  weekStart: Date;
  weekEnd: Date;
  weekLabel: string;
  weekColumns: StaffWeekColumn[];
  weekGrid: StaffWeekGridRow[];
}

function staffInitials(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "?";
}

export function staffOperatesLocation(
  membership: StaffMembership,
  locationId: string,
): boolean {
  return (
    membership.locationIds.length === 0 ||
    membership.locationIds.includes(locationId)
  );
}

export function startOfStaffWeek(now: Date): Date {
  const start = startOfDay(now);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(start);
  monday.setDate(monday.getDate() + diff);
  return startOfDay(monday);
}

export function addStaffWeekDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return startOfDay(next);
}

export function formatStaffWeekLabel(weekStart: Date): string {
  const weekEnd = addStaffWeekDays(weekStart, 6);
  return `${formatSlashDate(weekStart)} – ${formatSlashDate(weekEnd)}`;
}

function formatSlashDate(date: Date): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

export function formatStaffHoursValue(minutes: number): string {
  const hours = minutes / 60;
  if (!Number.isFinite(hours) || hours <= 0) return "0h";
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${Math.round(hours * 10) / 10}h`;
}

export function formatStaffAverageHours(minutes: number): string {
  const hours = minutes / 60;
  if (!Number.isFinite(hours) || hours <= 0) return "0h";
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded}h`;
}

function compactHm(hm: string): string {
  const [h, m] = hm.split(":");
  if (m === "00") return String(Number(h));
  return `${Number(h)}:${m}`;
}

function hoursForDay(
  hours: StaffWorkingHours[],
  staffId: string,
  locationId: string,
  dayOfWeek: DayOfWeek,
): StaffWorkingHours | undefined {
  return hours.find(
    (item) =>
      item.staffId === staffId &&
      item.locationId === locationId &&
      item.dayOfWeek === dayOfWeek,
  );
}

function approvedTimeOffOnDay(
  timeOff: StaffTimeOff[],
  staffId: string,
  locationId: string,
  day: Date,
): StaffTimeOff[] {
  const from = startOfDay(day).getTime();
  const to = endOfDay(day).getTime();
  return timeOff.filter((item) => {
    if (item.staffId !== staffId || item.locationId !== locationId) return false;
    if (item.status !== "APPROVED") return false;
    return new Date(item.startAt).getTime() < to && new Date(item.endAt).getTime() > from;
  });
}

function breaksOnDay(
  breaks: StaffBreak[],
  staffId: string,
  locationId: string,
  day: Date,
): StaffBreak[] {
  const from = startOfDay(day).getTime();
  const to = endOfDay(day).getTime();
  return breaks.filter((item) => {
    if (item.staffId !== staffId || item.locationId !== locationId) return false;
    return new Date(item.startAt).getTime() < to && new Date(item.endAt).getTime() > from;
  });
}

function overlapMinutes(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  if (end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

function subtractIntervals(
  start: Date,
  end: Date,
  cuts: Array<{ start: Date; end: Date }>,
): Array<{ start: Date; end: Date }> {
  const sorted = [...cuts]
    .map((cut) => ({
      start: new Date(Math.max(start.getTime(), cut.start.getTime())),
      end: new Date(Math.min(end.getTime(), cut.end.getTime())),
    }))
    .filter((cut) => cut.end.getTime() > cut.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const remaining: Array<{ start: Date; end: Date }> = [];
  let cursor = start;
  for (const cut of sorted) {
    if (cut.start.getTime() > cursor.getTime()) {
      remaining.push({ start: cursor, end: cut.start });
    }
    if (cut.end.getTime() > cursor.getTime()) {
      cursor = cut.end;
    }
  }
  if (cursor.getTime() < end.getTime()) {
    remaining.push({ start: cursor, end });
  }
  return remaining;
}

function isFullDayCoverage(
  offs: StaffTimeOff[],
  day: Date,
  workStart?: Date,
  workEnd?: Date,
): boolean {
  const dayStart = startOfDay(day);
  const dayFinish = endOfDay(day);
  return offs.some((off) => {
    const start = new Date(off.startAt);
    const end = new Date(off.endAt);
    const coversLocalDay = start <= dayStart && end >= dayFinish;
    const coversWork =
      workStart && workEnd
        ? start <= workStart && end >= workEnd
        : false;
    return coversLocalDay || coversWork;
  });
}

export function deriveStaffDayCell(input: {
  staffId: string;
  locationId: string;
  day: Date;
  workingHours: StaffWorkingHours[];
  timeOff: StaffTimeOff[];
}): StaffDayCell {
  const dayOfWeek = input.day.getDay() as DayOfWeek;
  const ymd = formatYmd(input.day);
  const hours = hoursForDay(
    input.workingHours,
    input.staffId,
    input.locationId,
    dayOfWeek,
  );
  const offs = approvedTimeOffOnDay(
    input.timeOff,
    input.staffId,
    input.locationId,
    input.day,
  );

  if (!hours) {
    return {
      ymd,
      dayOfWeek,
      kind: "unset",
      segments: offs.map((off) => ({
        kind: "time_off" as const,
        startHm: formatHm(new Date(off.startAt)),
        endHm: formatHm(new Date(off.endAt)),
        label: off.reason ?? "休假",
      })),
      compactLabel: offs.length > 0 ? "休" : "—",
      scheduledMinutes: 0,
      timeOffMinutes: offs.length > 0 ? 1 : 0,
    };
  }

  if (!hours.isWorking) {
    return {
      ymd,
      dayOfWeek,
      kind: "off",
      segments: offs.map((off) => ({
        kind: "time_off" as const,
        startHm: formatHm(new Date(off.startAt)),
        endHm: formatHm(new Date(off.endAt)),
        label: off.reason ?? "休假",
      })),
      compactLabel: "休",
      scheduledMinutes: 0,
      timeOffMinutes: offs.length > 0 ? overlapOrFlag(offs) : 0,
    };
  }

  const workStart = combineLocalDateTime(ymd, hours.startTime);
  const workEnd = combineLocalDateTime(ymd, hours.endTime);
  const workMinutes = Math.max(
    0,
    parseHmToMinutes(hours.endTime) - parseHmToMinutes(hours.startTime),
  );
  const cutWindows = offs.map((off) => ({
    start: new Date(off.startAt),
    end: new Date(off.endAt),
  }));
  const remaining = subtractIntervals(workStart, workEnd, cutWindows);
  const scheduledMinutes = remaining.reduce(
    (sum, window) =>
      sum + overlapMinutes(window.start, window.end, workStart, workEnd),
    0,
  );
  const timeOffMinutes = Math.max(0, workMinutes - scheduledMinutes);
  const fullCover = remaining.length === 0 || isFullDayCoverage(offs, input.day, workStart, workEnd);

  if (fullCover) {
    return {
      ymd,
      dayOfWeek,
      kind: "time_off",
      segments: [
        {
          kind: "time_off",
          startHm: hours.startTime,
          endHm: hours.endTime,
          label: offs[0]?.reason ?? "休假",
        },
      ],
      compactLabel: "休",
      scheduledMinutes: 0,
      timeOffMinutes: workMinutes,
    };
  }

  const workingSegments: StaffTimeSegment[] = remaining.map((window) => ({
    kind: "working",
    startHm: formatHm(window.start),
    endHm: formatHm(window.end),
    label: `${formatHm(window.start)}–${formatHm(window.end)}`,
  }));
  const offSegments: StaffTimeSegment[] = offs.map((off) => ({
    kind: "time_off",
    startHm: formatHm(new Date(off.startAt)),
    endHm: formatHm(new Date(off.endAt)),
    label: off.reason ?? "休假",
  }));

  if (offs.length === 0) {
    return {
      ymd,
      dayOfWeek,
      kind: "working",
      segments: [
        {
          kind: "working",
          startHm: hours.startTime,
          endHm: hours.endTime,
          label: `${hours.startTime}–${hours.endTime}`,
        },
      ],
      compactLabel: `${compactHm(hours.startTime)}–${compactHm(hours.endTime)}`,
      scheduledMinutes: workMinutes,
      timeOffMinutes: 0,
    };
  }

  return {
    ymd,
    dayOfWeek,
    kind: "mixed",
    segments: [...workingSegments, ...offSegments],
    compactLabel: workingSegments
      .map((segment) => `${compactHm(segment.startHm)}–${compactHm(segment.endHm)}`)
      .join(" / "),
    scheduledMinutes,
    timeOffMinutes,
  };
}

function overlapOrFlag(offs: StaffTimeOff[]): number {
  return offs.length > 0 ? 1 : 0;
}

export function deriveStaffWeekStats(cells: StaffDayCell[], staffId: string): StaffWeekStats {
  return {
    staffId,
    scheduledDays: cells.filter((cell) => cell.scheduledMinutes > 0).length,
    timeOffDays: cells.filter(
      (cell) => cell.kind === "time_off" || cell.kind === "mixed" || cell.timeOffMinutes > 0,
    ).length,
    scheduledMinutes: cells.reduce((sum, cell) => sum + cell.scheduledMinutes, 0),
  };
}

function deriveTodayStatus(input: {
  isActive: boolean;
  todayCell: StaffDayCell;
}): StaffTodayStatus {
  if (!input.isActive) return "inactive";
  if (input.todayCell.kind === "time_off") return "time_off";
  if (input.todayCell.kind === "working" || input.todayCell.kind === "mixed") {
    return "working";
  }
  return "off";
}

function deriveTodayHoursLabel(input: {
  status: StaffTodayStatus;
  todayCell: StaffDayCell;
}): string {
  if (input.status === "inactive") return "";
  if (input.todayCell.kind === "time_off") return "今日休假";
  if (input.todayCell.kind === "working" || input.todayCell.kind === "mixed") {
    const first = input.todayCell.segments.find((segment) => segment.kind === "working");
    if (first) return `今日 ${first.startHm}–${first.endHm}`;
  }
  return "今日未排班";
}

export function buildStaffWorkspace(input: {
  organizationId: string;
  locationId: string;
  locationName: string;
  memberships: StaffMembership[];
  workingHours: StaffWorkingHours[];
  breaks: StaffBreak[];
  timeOff: StaffTimeOff[];
  now: Date;
  weekStart?: Date;
  pendingInviteMembershipIds?: readonly string[];
  staffInvites?: ReadonlyArray<{
    membershipId: string;
    status: string;
    expiresAt: string;
    invitedAuthUserId: string | null;
  }>;
}): StaffWorkspaceModel {
  const weekStart = input.weekStart
    ? startOfDay(input.weekStart)
    : startOfStaffWeek(input.now);
  const weekEnd = addStaffWeekDays(weekStart, 6);
  const weekColumns: StaffWeekColumn[] = Array.from({ length: 7 }, (_, index) => {
    const date = addStaffWeekDays(weekStart, index);
    const dayOfWeek = date.getDay() as DayOfWeek;
    return {
      date,
      ymd: formatYmd(date),
      dayOfWeek,
      headerLabel: `${DAY_OF_WEEK_LABEL[dayOfWeek]} ${date.getMonth() + 1}/${date.getDate()}`,
    };
  });

  const scopedMemberships = input.memberships
    .filter(
      (membership) =>
        membership.organizationId === input.organizationId &&
        staffOperatesLocation(membership, input.locationId),
    )
    .slice()
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt) || a.userId.localeCompare(b.userId);
    });

  const scopedHours = input.workingHours.filter(
    (item) =>
      item.organizationId === input.organizationId &&
      item.locationId === input.locationId,
  );
  const scopedBreaks = input.breaks.filter(
    (item) =>
      item.organizationId === input.organizationId &&
      item.locationId === input.locationId,
  );
  const scopedTimeOff = input.timeOff.filter(
    (item) =>
      item.organizationId === input.organizationId &&
      item.locationId === input.locationId,
  );

  const today = startOfDay(input.now);
  const rows: StaffWorkspaceRow[] = [];
  const weekGrid: StaffWeekGridRow[] = [];

  for (const membership of scopedMemberships) {
    const cells = weekColumns.map((column) =>
      deriveStaffDayCell({
        staffId: membership.userId,
        locationId: input.locationId,
        day: column.date,
        workingHours: scopedHours,
        timeOff: scopedTimeOff,
      }),
    );
    const stats = deriveStaffWeekStats(cells, membership.userId);
    const todayCell =
      cells.find((cell) => cell.ymd === formatYmd(today)) ??
      deriveStaffDayCell({
        staffId: membership.userId,
        locationId: input.locationId,
        day: today,
        workingHours: scopedHours,
        timeOff: scopedTimeOff,
      });
    const todayStatus = deriveTodayStatus({
      isActive: membership.isActive,
      todayCell,
    });
    const todayBreaks = breaksOnDay(
      scopedBreaks,
      membership.userId,
      input.locationId,
      today,
    ).map((item) => ({
      id: item.id,
      label: item.label ?? "休息",
      rangeLabel: `${formatHm(new Date(item.startAt))}–${formatHm(new Date(item.endAt))}`,
    }));
    const workingSegment = todayCell.segments.find((segment) => segment.kind === "working");
    const roleLabel = STAFF_ROLE_LABEL[membership.role];
    const title = membership.title?.trim() || null;
    const membershipInvite = pickLatestStaffInviteForMembership(
      input.staffInvites ?? [],
      membership.id,
      input.now,
    );
    const inviteLifecycle = deriveStaffInviteLifecycle({
      authUserId: membership.authUserId ?? null,
      invite: membershipInvite,
      now: input.now,
    });
    let loginBinding = loginBindingFromLifecycle(inviteLifecycle);
    if (
      loginBinding === "unbound" &&
      (input.pendingInviteMembershipIds ?? []).includes(membership.id)
    ) {
      loginBinding = "pending";
    }

    rows.push({
      staffId: membership.userId,
      membershipId: membership.id,
      organizationId: membership.organizationId,
      displayName: membership.displayName,
      initials: staffInitials(membership.displayName),
      role: membership.role,
      roleLabel,
      title,
      loginBinding,
      inviteLifecycle,
      email: membership.email ?? null,
      authUserId: membership.authUserId ?? null,
      locationIds: membership.locationIds,
      locationLabel: input.locationName,
      isActive: membership.isActive,
      employmentLabel: membership.isActive ? "在職" : "停用",
      todayStatus,
      todayStatusLabel: STAFF_TODAY_STATUS_LABEL[todayStatus],
      todayHoursLabel: deriveTodayHoursLabel({ status: todayStatus, todayCell }),
      todayWorkStartHm: workingSegment?.startHm ?? null,
      todayWorkEndHm: workingSegment?.endHm ?? null,
      todayBreaks,
      searchText: `${membership.displayName} ${membership.role} ${roleLabel} ${title ?? ""}`.toLowerCase(),
    });

    weekGrid.push({
      staffId: membership.userId,
      displayName: membership.displayName,
      cells,
      stats,
    });
  }

  return {
    rows,
    summary: countStaffWorkspaceSummary(rows, weekGrid),
    weekStart,
    weekEnd,
    weekLabel: formatStaffWeekLabel(weekStart),
    weekColumns,
    weekGrid,
  };
}

export function countStaffWorkspaceSummary(
  rows: StaffWorkspaceRow[],
  weekGrid: StaffWeekGridRow[],
): StaffWorkspaceSummary {
  const active = rows.filter((row) => row.isActive);
  const activeCount = active.length;
  const inactiveCount = rows.length - activeCount;
  const todayWorkingCount = active.filter((row) => row.todayStatus === "working").length;
  const todayTimeOffCount = active.filter((row) => row.todayStatus === "time_off").length;
  const weeklyScheduledMinutes = weekGrid
    .filter((grid) => active.some((row) => row.staffId === grid.staffId))
    .reduce((sum, grid) => sum + grid.stats.scheduledMinutes, 0);
  const weeklyAverageMinutes =
    activeCount > 0 ? weeklyScheduledMinutes / activeCount : 0;

  return {
    activeCount,
    inactiveCount,
    todayWorkingCount,
    todayTimeOffCount,
    weeklyScheduledMinutes,
    weeklyAverageMinutes,
    todayWorkingRate: activeCount > 0 ? todayWorkingCount / activeCount : 0,
    todayTimeOffRate: activeCount > 0 ? todayTimeOffCount / activeCount : 0,
  };
}

export function matchesStaffSearch(row: StaffWorkspaceRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return row.searchText.includes(needle);
}

export function filterStaffRows(
  rows: StaffWorkspaceRow[],
  filter: StaffEmploymentFilter,
  query: string,
): StaffWorkspaceRow[] {
  return rows.filter((row) => {
    if (filter === "active" && !row.isActive) return false;
    if (filter === "inactive" && row.isActive) return false;
    return matchesStaffSearch(row, query);
  });
}

export function resolveSelectedStaffRow(
  rows: StaffWorkspaceRow[],
  selectedStaffId: string | null,
): StaffWorkspaceRow | null {
  if (!selectedStaffId) return null;
  return rows.find((row) => row.staffId === selectedStaffId) ?? null;
}

export function shouldResetStaffSelection(input: {
  selectedStaffId: string | null;
  visibleRows: StaffWorkspaceRow[];
}): boolean {
  if (!input.selectedStaffId) return false;
  return !input.visibleRows.some((row) => row.staffId === input.selectedStaffId);
}

export function shouldRenderStaffQuickView(
  selected: StaffWorkspaceRow | null,
): boolean {
  return selected !== null;
}

export function isInlineStaffQuickViewViewport(widthPx: number): boolean {
  return widthPx >= STAFF_WORKSPACE_INLINE_MIN_PX;
}

export function staffListPresentation(
  widthPx: number,
): "desktop-rows" | "mobile-cards" {
  return isInlineStaffQuickViewViewport(widthPx) ? "desktop-rows" : "mobile-cards";
}

export function staffWeekPresentation(
  widthPx: number,
): "desktop-grid" | "mobile-day" {
  return isInlineStaffQuickViewViewport(widthPx) ? "desktop-grid" : "mobile-day";
}

export function isStaffRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function listUpcomingTimeOff(input: {
  timeOff: StaffTimeOff[];
  organizationId: string;
  locationId: string;
  staffId: string;
  now: Date;
}): UpcomingTimeOffView[] {
  const boundary = startOfDay(input.now).getTime();
  return input.timeOff
    .filter(
      (item) =>
        item.organizationId === input.organizationId &&
        item.locationId === input.locationId &&
        item.staffId === input.staffId &&
        new Date(item.endAt).getTime() >= boundary,
    )
    .slice()
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((item) => {
      const start = new Date(item.startAt);
      const end = new Date(item.endAt);
      const fullDay =
        start.getTime() <= startOfDay(start).getTime() &&
        end.getTime() >= endOfDay(start).getTime();
      return {
        id: item.id,
        staffId: item.staffId,
        startAt: item.startAt,
        endAt: item.endAt,
        dateLabel: `${start.getMonth() + 1}/${String(start.getDate()).padStart(2, "0")}`,
        timeLabel: fullDay ? "全天休假" : `${formatHm(start)}–${formatHm(end)}`,
        reason: item.reason,
        status: item.status,
        isFullDay: fullDay,
      };
    });
}

export function listStaffBreakViews(input: {
  breaks: StaffBreak[];
  organizationId: string;
  locationId: string;
  staffId: string;
}): Array<{ id: string; label: string; rangeLabel: string; dateLabel: string }> {
  return input.breaks
    .filter(
      (item) =>
        item.organizationId === input.organizationId &&
        item.locationId === input.locationId &&
        item.staffId === input.staffId,
    )
    .slice()
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((item) => {
      const start = new Date(item.startAt);
      return {
        id: item.id,
        label: item.label ?? "休息",
        rangeLabel: `${formatHm(start)}–${formatHm(new Date(item.endAt))}`,
        dateLabel: formatYmd(start),
      };
    });
}

const APPLY_DAYS: Record<StaffApplyHoursPattern, DayOfWeek[]> = {
  "mon-fri": [1, 2, 3, 4, 5],
  "mon-sat": [1, 2, 3, 4, 5, 6],
};

export function planApplyWorkingHoursPattern(input: {
  locationId: string;
  staffId: string;
  hours: StaffWorkingHours[];
  pattern: StaffApplyHoursPattern;
}): StaffApplyHoursDraft[] {
  const scoped = input.hours.filter(
    (item) => item.staffId === input.staffId && item.locationId === input.locationId,
  );
  const monday = scoped.find((item) => item.dayOfWeek === 1 && item.isWorking);
  const source =
    monday ??
    scoped.find((item) => item.isWorking) ??
    ({
      startTime: `${String(CALENDAR_DAY_START_HOUR).padStart(2, "0")}:00`,
      endTime: `${String(CALENDAR_DAY_END_HOUR).padStart(2, "0")}:00`,
    } as const);

  return APPLY_DAYS[input.pattern].map((dayOfWeek) => ({
    locationId: input.locationId,
    staffId: input.staffId,
    dayOfWeek,
    startTime: source.startTime,
    endTime: source.endTime,
    isWorking: true,
  }));
}

export function staffEmptyCopy(input: {
  hasStaff: boolean;
  filter: StaffEmploymentFilter;
  query: string;
}): {
  kind: "none" | "filtered";
  title: string;
  showClear: boolean;
} {
  if (!input.hasStaff) {
    return { kind: "none", title: "尚無員工資料", showClear: false };
  }
  return {
    kind: "filtered",
    title:
      input.filter === "inactive"
        ? "目前沒有停用員工"
        : input.query.trim()
          ? "找不到符合的員工"
          : "目前沒有在職員工",
    showClear: true,
  };
}

export function formatStaffPercent(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "0%";
  return `${Math.round(rate * 100)}%`;
}
