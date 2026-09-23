"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import {
  CALENDAR_DAY_END_HOUR,
  CALENDAR_DAY_START_HOUR,
  CALENDAR_SLOT_MINUTES,
  CALENDAR_SLOT_PX,
  DEFAULT_SERVICE_DURATION_MINUTES,
} from "@/lib/appointments/calendar-config";
import {
  addMinutes,
  allowedTransitions,
  combineLocalDateTime,
  formatHm,
  formatYmd,
  STATUS_LABEL,
  startOfDay,
  type CanonicalAppointmentStatus,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import {
  createAppointment,
  listAppointments,
  staffOptionsForLocation,
  transitionAppointmentStatus,
  updateAppointment,
} from "@/lib/appointments/store";
import {
  describeAvailability,
  findAvailableStaff,
  getStaffAvailability,
} from "@/lib/staff-schedule/availability";
import {
  dayOfWeekLocal,
  parseHmToMinutes,
  type StaffBreak,
  type StaffTimeOff,
} from "@/lib/staff-schedule/domain";
import {
  getStaffScheduleRevision,
  getWorkingHoursForDay,
  listBookableStaff,
  listBreaks,
  listTimeOff,
  subscribeStaffSchedule,
} from "@/lib/staff-schedule/store";
import {
  readCalendarViewPrefs,
  writeCalendarViewPrefs,
  type CalendarViewMode,
} from "@/lib/staff-schedule/prefs";
import {
  absoluteMinutesFromDate,
  layoutBlockInVisibleRange,
} from "@/lib/appointments/visible-range";
import {
  getCompletedTransactionForAppointment,
  hasCompletedTransactionForAppointment,
} from "@/lib/commerce/transaction-store";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { getCustomerById } from "@/data/mock-customers";
import { getServicesForOrganization } from "@/data/mock-services";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";
import type { StaffMembership } from "@/types/saas";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
const DAY_MINUTES_START = CALENDAR_DAY_START_HOUR * 60;
const DAY_MINUTES_END = CALENDAR_DAY_END_HOUR * 60;
const TOTAL_SLOTS = (DAY_MINUTES_END - DAY_MINUTES_START) / CALENDAR_SLOT_MINUTES;
const GRID_HEIGHT = TOTAL_SLOTS * CALENDAR_SLOT_PX;
const TIME_COL_PX = 48;
/** Below this staff count, columns share available width evenly */
const STAFF_FILL_THRESHOLD = 4;
const STAFF_COL_MIN_PX = 128;

function staffGridTemplate(count: number): string {
  if (count <= 0) return `${TIME_COL_PX}px`;
  if (count <= STAFF_FILL_THRESHOLD) {
    return `${TIME_COL_PX}px repeat(${count}, minmax(0, 1fr))`;
  }
  return `${TIME_COL_PX}px repeat(${count}, minmax(${STAFF_COL_MIN_PX}px, 1fr))`;
}

function staffGridMinWidth(count: number): string | undefined {
  if (count <= STAFF_FILL_THRESHOLD) return undefined;
  return `${TIME_COL_PX + count * STAFF_COL_MIN_PX}px`;
}

function layoutTimedBlock(start: Date, end: Date) {
  return layoutBlockInVisibleRange({
    startMinutes: absoluteMinutesFromDate(start),
    endMinutes: absoluteMinutesFromDate(end),
    visibleStartMinutes: DAY_MINUTES_START,
    visibleEndMinutes: DAY_MINUTES_END,
    slotMinutes: CALENDAR_SLOT_MINUTES,
    slotPx: CALENDAR_SLOT_PX,
  });
}

function useDialogA11y(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const root = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusable()[0]?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return ref;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

export interface CreatePrefill {
  staffId?: string;
  dateYmd?: string;
  startHm?: string;
}

export function CalendarPage() {
  const { organization, currentLocation, locations, membership } = useOrganization();
  const revision = useSyncExternalStore(subscribeAppointments, getAppointmentStatusRaw, () => "");
  const scheduleRev = useSyncExternalStore(
    subscribeStaffSchedule,
    getStaffScheduleRevision,
    () => "",
  );
  void revision;
  void scheduleRev;

  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<CalendarViewMode>(() =>
    readCalendarViewPrefs(organization.id).desktopView,
  );
  const [mobileDay, setMobileDay] = useState(() => new Date());
  const [selected, setSelected] = useState<ScheduleAppointment | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [prefill, setPrefill] = useState<CreatePrefill | null>(null);
  const [staffFilter, setStaffFilter] = useState<string[]>([]);

  const locationId = currentLocation?.id ?? locations[0]?.id ?? "";
  const staffRoster = listBookableStaff(organization.id, locationId);
  const visibleStaff =
    staffFilter.length === 0
      ? staffRoster
      : staffRoster.filter((s) => staffFilter.includes(s.userId));

  const appointments = listAppointments({
    organizationId: organization.id,
    locationId,
  });

  const weekStart = startOfWeek(anchor);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function setViewPersisted(next: CalendarViewMode) {
    setView(next);
    writeCalendarViewPrefs(organization.id, { desktopView: next });
  }

  function openCreate(nextPrefill?: CreatePrefill) {
    setSelected(null);
    setEditing(false);
    setPrefill(nextPrefill ?? null);
    setCreating(true);
  }

  function toggleStaffFilter(staffId: string) {
    setStaffFilter((prev) =>
      prev.includes(staffId) ? prev.filter((id) => id !== staffId) : [...prev, staffId],
    );
  }

  const filteredAppointments =
    staffFilter.length === 0
      ? appointments
      : appointments.filter((a) => staffFilter.includes(a.staffId));

  return (
    <div className="flex min-h-0 flex-col space-y-3 min-[720px]:space-y-4">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">行事曆</h1>
          <p className="mt-1 text-sm text-secondary-text">
            {currentLocation?.name ?? "分店"} · {organization.name}
            {view === "day" ? " · 美容師日曆" : " · 週工作量"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              const today = new Date();
              setAnchor(today);
              setMobileDay(today);
            }}
          >
            今天
          </Button>
          <Button
            variant="ghost"
            className="min-h-11 min-w-11 px-3"
            aria-label="上一段"
            onClick={() => {
              const next = addDays(anchor, view === "week" ? -7 : -1);
              setAnchor(next);
              setMobileDay(next);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            className="min-h-11 min-w-11 px-3"
            aria-label="下一段"
            onClick={() => {
              const next = addDays(anchor, view === "week" ? 7 : 1);
              setAnchor(next);
              setMobileDay(next);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="hidden gap-1 min-[720px]:flex">
            {(["day", "week"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                onClick={() => setViewPersisted(id)}
                className={cn(
                  "min-h-11 rounded-2xl px-4 text-sm font-medium",
                  view === id ? "bg-primary text-white" : "bg-primary-light/60 text-text",
                )}
              >
                {id === "day" ? "日" : "週"}
              </button>
            ))}
          </div>
          <Button className="min-h-11" onClick={() => openCreate()} aria-label="新增預約">
            <Plus className="h-4 w-4" />
            新增預約
          </Button>
        </div>
      </header>

      <StaffFilterBar
        staff={staffRoster}
        selected={staffFilter}
        onToggle={toggleStaffFilter}
        onClear={() => setStaffFilter([])}
      />

      {/* Mobile agenda */}
      <div className="space-y-3 min-[720px]:hidden">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {weekDays.map((day) => {
            const active = formatYmd(day) === formatYmd(mobileDay);
            return (
              <button
                key={formatYmd(day)}
                type="button"
                onClick={() => setMobileDay(day)}
                className={cn(
                  "min-h-11 min-w-14 shrink-0 rounded-2xl px-3 text-sm",
                  active ? "bg-primary text-white" : "bg-surface text-text",
                )}
              >
                {WEEKDAY[day.getDay()]} {day.getDate()}
              </button>
            );
          })}
        </div>
        <AgendaList
          day={mobileDay}
          appointments={filteredAppointments}
          onSelect={setSelected}
        />
        <Button fullWidth className="min-h-11 sticky bottom-4" onClick={() => openCreate()}>
          ＋ 新增預約
        </Button>
      </div>

      {/* Desktop / tablet */}
      <div className="hidden min-h-0 min-[720px]:block">
        {view === "day" ? (
          <StaffDayGrid
            day={anchor}
            organizationId={organization.id}
            locationId={locationId}
            staff={visibleStaff}
            appointments={filteredAppointments}
            onSelect={setSelected}
            onEmptySlot={(staffId, hm) =>
              openCreate({ staffId, dateYmd: formatYmd(anchor), startHm: hm })
            }
          />
        ) : (
          <WeekGrid
            days={weekDays}
            appointments={filteredAppointments}
            onSelect={setSelected}
          />
        )}
      </div>

      {creating || editing ? (
        <AppointmentEditor
          organizationId={organization.id}
          locationId={locationId}
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          initial={editing ? selected : null}
          prefill={creating ? prefill : null}
          actorId={membership?.userId}
          onClose={() => {
            setCreating(false);
            setEditing(false);
            setPrefill(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(false);
            setPrefill(null);
            setSelected(null);
          }}
        />
      ) : null}

      {selected && !editing && !creating ? (
        <AppointmentDetail
          item={selected}
          locationName={
            locations.find((l) => l.id === selected.locationId)?.name ??
            currentLocation?.name
          }
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(true)}
          onTransition={(status) => {
            const next = transitionAppointmentStatus(
              organization.id,
              selected.id,
              status,
              membership?.userId,
            );
            setSelected(next);
          }}
        />
      ) : null}
    </div>
  );
}

function StaffFilterBar({
  staff,
  selected,
  onToggle,
  onClear,
}: {
  staff: StaffMembership[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  if (staff.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="美容師篩選">
      <button
        type="button"
        aria-pressed={selected.length === 0}
        onClick={onClear}
        className={cn(
          "min-h-11 rounded-2xl px-3 text-sm",
          selected.length === 0 ? "bg-primary text-white" : "bg-surface text-text",
        )}
      >
        全部美容師
      </button>
      {staff.map((s) => {
        const active = selected.includes(s.userId);
        return (
          <button
            key={s.userId}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(s.userId)}
            className={cn(
              "min-h-11 rounded-2xl px-3 text-sm",
              active ? "bg-primary text-white" : "bg-surface text-text",
            )}
          >
            {s.displayName}
          </button>
        );
      })}
    </div>
  );
}

function TimeAxis() {
  const labels = Array.from({ length: TOTAL_SLOTS + 1 }, (_, i) => {
    const minutes = DAY_MINUTES_START + i * CALENDAR_SLOT_MINUTES;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return { i, label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, hour: m === 0 };
  });
  return (
    <div
      className="relative shrink-0"
      style={{ width: TIME_COL_PX, height: GRID_HEIGHT }}
      aria-hidden
    >
      {labels.map(({ i, label, hour }) =>
        hour || i === labels.length - 1 ? (
          <div
            key={label + i}
            className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-secondary-text"
            style={{ top: i * CALENDAR_SLOT_PX }}
          >
            {label}
          </div>
        ) : null,
      )}
    </div>
  );
}

function SlotLines() {
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: TOTAL_SLOTS }, (_, i) => {
        const isHour = (i * CALENDAR_SLOT_MINUTES) % 60 === 0;
        return (
          <div
            key={i}
            className={cn(
              "absolute left-0 right-0 border-t",
              isHour ? "border-border/70" : "border-border/25",
            )}
            style={{ top: i * CALENDAR_SLOT_PX }}
          />
        );
      })}
    </div>
  );
}

function StaffDayGrid({
  day,
  organizationId,
  locationId,
  staff,
  appointments,
  onSelect,
  onEmptySlot,
}: {
  day: Date;
  organizationId: string;
  locationId: string;
  staff: StaffMembership[];
  appointments: ScheduleAppointment[];
  onSelect: (item: ScheduleAppointment) => void;
  onEmptySlot: (staffId: string, hm: string) => void;
}) {
  const dayYmd = formatYmd(day);
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const columns = staffGridTemplate(staff.length);
  const minWidth = staffGridMinWidth(staff.length);

  if (staff.length === 0) {
    return (
      <Card padding="lg" className="text-center text-sm text-secondary-text">
        此分店目前沒有可排班美容師
      </Card>
    );
  }

  return (
    <div
      className="w-full overflow-hidden rounded-2xl border border-border bg-surface"
      style={{ maxHeight: "calc(100dvh - 12.5rem)" }}
    >
      <div className="calendar-body-scroll h-full max-h-[inherit] overflow-auto">
        <div style={{ minWidth: minWidth ?? "100%" }}>
          <div
            className="sticky top-0 z-10 grid border-b border-border bg-surface/95 backdrop-blur-sm"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="px-1.5 py-2 text-[10px] tabular-nums text-secondary-text">
              {day.getMonth() + 1}/{day.getDate()}
            </div>
            {staff.map((s) => (
              <div key={s.userId} className="border-l border-border/50 px-2 py-1.5 text-center">
                <div
                  className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary"
                  aria-hidden
                >
                  {s.displayName.slice(0, 1)}
                </div>
                <p className="mt-0.5 truncate text-xs font-medium text-text">{s.displayName}</p>
                <p className="truncate text-[10px] text-secondary-text">{s.role}</p>
              </div>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: columns }}>
            <TimeAxis />
            {staff.map((s) => {
              const hours = getWorkingHoursForDay(
                organizationId,
                locationId,
                s.userId,
                dayOfWeekLocal(day),
              );
              const breaks = listBreaks(organizationId, {
                locationId,
                staffId: s.userId,
                from: dayStart,
                to: dayEnd,
              });
              const offs = listTimeOff(organizationId, {
                locationId,
                staffId: s.userId,
                from: dayStart,
                to: dayEnd,
              }).filter((t) => t.status === "APPROVED");
              const columnAppts = appointments.filter(
                (a) => a.staffId === s.userId && formatYmd(new Date(a.startAt)) === dayYmd,
              );
              return (
                <StaffColumn
                  key={s.userId}
                  staff={s}
                  workingHours={hours}
                  breaks={breaks}
                  timeOff={offs}
                  appointments={columnAppts}
                  hideStaffName
                  onSelect={onSelect}
                  onEmptySlot={(hm) => onEmptySlot(s.userId, hm)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function StaffColumn({
  staff,
  workingHours,
  breaks,
  timeOff,
  appointments,
  hideStaffName,
  onSelect,
  onEmptySlot,
}: {
  staff: StaffMembership;
  workingHours: ReturnType<typeof getWorkingHoursForDay>;
  breaks: StaffBreak[];
  timeOff: StaffTimeOff[];
  appointments: ScheduleAppointment[];
  hideStaffName?: boolean;
  onSelect: (item: ScheduleAppointment) => void;
  onEmptySlot: (hm: string) => void;
}) {
  const workStart = workingHours?.isWorking
    ? parseHmToMinutes(workingHours.startTime)
    : null;
  const workEnd = workingHours?.isWorking ? parseHmToMinutes(workingHours.endTime) : null;

  return (
    <div
      className="relative min-w-0 border-l border-border/40"
      style={{ height: GRID_HEIGHT }}
      role="gridcell"
      aria-label={`${staff.displayName} 時段`}
    >
      <SlotLines />
      {workStart == null || workEnd == null ? (
        <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--text)_3%,transparent)]" aria-hidden />
      ) : (
        <>
          {workStart > DAY_MINUTES_START ? (
            <div
              className="absolute left-0 right-0 bg-[color-mix(in_srgb,var(--text)_3.5%,transparent)]"
              style={{
                top: 0,
                height: ((workStart - DAY_MINUTES_START) / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_PX,
              }}
              aria-hidden
            />
          ) : null}
          {workEnd < DAY_MINUTES_END ? (
            <div
              className="absolute left-0 right-0 bg-[color-mix(in_srgb,var(--text)_3.5%,transparent)]"
              style={{
                top: ((workEnd - DAY_MINUTES_START) / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_PX,
                bottom: 0,
              }}
              aria-hidden
            />
          ) : null}
        </>
      )}

      {timeOff.map((off) => {
        const layout = layoutTimedBlock(new Date(off.startAt), new Date(off.endAt));
        if (!layout.visible) return null;
        return (
          <div
            key={off.id}
            className="absolute left-1 right-1 overflow-hidden rounded-md border border-dashed border-border/80 bg-[color-mix(in_srgb,var(--secondary-text)_8%,transparent)] px-1.5 py-0.5 text-[10px] text-secondary-text"
            style={{ top: layout.topPx, height: layout.heightPx }}
          >
            <span className="whitespace-nowrap">休假</span>
            {off.reason ? <span className="ml-1 line-clamp-1">{off.reason}</span> : null}
          </div>
        );
      })}

      {breaks.map((br) => {
        const layout = layoutTimedBlock(new Date(br.startAt), new Date(br.endAt));
        if (!layout.visible) return null;
        return (
          <div
            key={br.id}
            className="absolute left-1 right-1 overflow-hidden rounded-md border border-border/60 bg-[color-mix(in_srgb,var(--secondary-text)_6%,transparent)] px-1.5 py-0.5 text-[10px] text-secondary-text"
            style={{ top: layout.topPx, height: layout.heightPx }}
          >
            <span className="whitespace-nowrap">{br.label ?? "休息"}</span>
            <span className="ml-1 whitespace-nowrap tabular-nums">
              {formatHm(new Date(br.startAt))}–{formatHm(new Date(br.endAt))}
            </span>
          </div>
        );
      })}

      {appointments.map((item) => {
        const layout = layoutTimedBlock(new Date(item.startAt), new Date(item.endAt));
        if (!layout.visible) return null;
        return (
          <AppointmentBlock
            key={item.id}
            item={item}
            top={layout.topPx}
            height={layout.heightPx}
            hideStaffName={hideStaffName}
            onSelect={onSelect}
          />
        );
      })}

      {Array.from({ length: TOTAL_SLOTS }, (_, i) => {
        const minutes = DAY_MINUTES_START + i * CALENDAR_SLOT_MINUTES;
        const hm = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
        return (
          <button
            key={hm}
            type="button"
            aria-label={`在 ${staff.displayName} ${hm} 新增預約`}
            className="absolute left-0 right-0 z-0 min-h-[28px] opacity-0 hover:bg-primary/[0.04] hover:opacity-100 focus:bg-primary/[0.06] focus:opacity-100 focus:outline-none"
            style={{ top: i * CALENDAR_SLOT_PX, height: CALENDAR_SLOT_PX }}
            onClick={() => onEmptySlot(hm)}
          />
        );
      })}
    </div>
  );
}

function AppointmentBlock({
  item,
  top,
  height,
  hideStaffName,
  onSelect,
}: {
  item: ScheduleAppointment;
  top: number;
  height: number;
  hideStaffName?: boolean;
  onSelect: (item: ScheduleAppointment) => void;
}) {
  const showService = height >= 40;
  const showStatus = height >= 54;
  const showStaff = !hideStaffName && height >= 68;
  const tooltip = [
    `${formatHm(new Date(item.startAt))}–${formatHm(new Date(item.endAt))}`,
    item.customerName,
    item.serviceName,
    hideStaffName ? null : item.staffName,
    STATUS_LABEL[item.status],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item);
      }}
      aria-label={tooltip}
      title={tooltip}
      className="absolute left-1 right-1 z-[1] overflow-hidden rounded-lg border border-border/80 bg-surface px-1.5 py-0.5 text-left shadow-[0_1px_1px_rgba(48,43,43,0.04)]"
      style={{ top, height }}
    >
      <p className="flex min-w-0 items-baseline gap-1 text-[11px] leading-tight text-text">
        <span className="shrink-0 whitespace-nowrap tabular-nums text-secondary-text">
          {formatHm(new Date(item.startAt))}
        </span>
        <span className="truncate font-medium">{item.customerName}</span>
      </p>
      {showService ? (
        <p className="truncate text-[10px] leading-tight text-secondary-text">{item.serviceName}</p>
      ) : null}
      {showStaff ? (
        <p className="truncate text-[10px] leading-tight text-secondary-text">{item.staffName}</p>
      ) : null}
      {showStatus ? (
        <span className="mt-0.5 inline-block max-w-full truncate rounded px-1 text-[9px] leading-4 tracking-wide text-secondary-text ring-1 ring-border/80">
          {STATUS_LABEL[item.status]}
        </span>
      ) : null}
    </button>
  );
}

function WeekGrid({
  days,
  appointments,
  onSelect,
}: {
  days: Date[];
  appointments: ScheduleAppointment[];
  onSelect: (item: ScheduleAppointment) => void;
}) {
  const columns = `${TIME_COL_PX}px repeat(7, minmax(0, 1fr))`;
  const weekMinWidth = TIME_COL_PX + 7 * 96;
  return (
    <div
      className="w-full overflow-hidden rounded-2xl border border-border bg-surface"
      style={{ maxHeight: "calc(100dvh - 12.5rem)" }}
    >
      <div className="calendar-body-scroll h-full max-h-[inherit] overflow-auto">
        <div className="w-full" style={{ minWidth: weekMinWidth }}>
          <div
            className="sticky top-0 z-10 grid border-b border-border bg-surface/95 backdrop-blur-sm"
            style={{ gridTemplateColumns: columns }}
          >
            <div />
            {days.map((day) => (
              <div
                key={formatYmd(day)}
                className="border-l border-border/50 px-2 py-1.5 text-center text-xs font-medium text-text"
              >
                {WEEKDAY[day.getDay()]} {day.getMonth() + 1}/{day.getDate()}
              </div>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: columns }}>
            <TimeAxis />
            {days.map((day) => {
              const ymd = formatYmd(day);
              const dayAppts = appointments.filter(
                (a) => formatYmd(new Date(a.startAt)) === ymd,
              );
              return (
                <div
                  key={ymd}
                  className="relative min-w-0 border-l border-border/40"
                  style={{ height: GRID_HEIGHT }}
                >
                  <SlotLines />
                  {dayAppts.map((item) => {
                    const layout = layoutTimedBlock(
                      new Date(item.startAt),
                      new Date(item.endAt),
                    );
                    if (!layout.visible) return null;
                    return (
                      <AppointmentBlock
                        key={item.id}
                        item={item}
                        top={layout.topPx}
                        height={layout.heightPx}
                        onSelect={onSelect}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgendaList({
  day,
  appointments,
  onSelect,
}: {
  day: Date;
  appointments: ScheduleAppointment[];
  onSelect: (item: ScheduleAppointment) => void;
}) {
  const items = appointments
    .filter((item) => formatYmd(new Date(item.startAt)) === formatYmd(day))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (items.length === 0) {
    return (
      <Card padding="lg" className="text-center text-sm text-secondary-text">
        今天還沒有預約
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item)}
          title={`${formatHm(new Date(item.startAt))}–${formatHm(new Date(item.endAt))} ${item.customerName} ${item.serviceName} ${item.staffName} ${STATUS_LABEL[item.status]}`}
          className="min-h-11 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-left"
        >
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-text">
            <span className="whitespace-nowrap tabular-nums text-secondary-text">
              {formatHm(new Date(item.startAt))}–{formatHm(new Date(item.endAt))}
            </span>
            <span className="font-medium">{item.customerName}</span>
          </p>
          <p className="mt-0.5 truncate text-sm text-secondary-text">{item.serviceName}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-secondary-text">
            <span className="whitespace-nowrap">{item.staffName}</span>
            <span className="rounded px-1.5 py-0.5 ring-1 ring-border whitespace-nowrap">
              {STATUS_LABEL[item.status]}
            </span>
          </p>
        </button>
      ))}
    </div>
  );
}

function AppointmentEditor({
  organizationId,
  locationId,
  locations,
  initial,
  prefill,
  actorId,
  onClose,
  onSaved,
}: {
  organizationId: string;
  locationId: string;
  locations: Array<{ id: string; name: string }>;
  initial: ScheduleAppointment | null;
  prefill: CreatePrefill | null;
  actorId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useDialogA11y(onClose);
  const customers = localCustomerRepository.list({ organizationId });
  const services = getServicesForOrganization(organizationId);
  const [loc, setLoc] = useState(initial?.locationId ?? locationId);
  const staff = staffOptionsForLocation(organizationId, loc);
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [serviceId, setServiceId] = useState(initial?.serviceId ?? services[0]?.id ?? "");
  const [staffId, setStaffId] = useState(
    initial?.staffId ?? prefill?.staffId ?? staff[0]?.userId ?? "",
  );
  const [date, setDate] = useState(
    initial
      ? formatYmd(new Date(initial.startAt))
      : (prefill?.dateYmd ?? formatYmd(new Date())),
  );
  const [start, setStart] = useState(
    initial ? formatHm(new Date(initial.startAt)) : (prefill?.startHm ?? "14:00"),
  );
  const service = services.find((s) => s.id === serviceId);
  const [end, setEnd] = useState(() => {
    if (initial) return formatHm(new Date(initial.endAt));
    const startHm = prefill?.startHm ?? "14:00";
    const dateYmd = prefill?.dateYmd ?? formatYmd(new Date());
    return formatHm(
      addMinutes(
        combineLocalDateTime(dateYmd, startHm),
        service?.durationMinutes ?? DEFAULT_SERVICE_DURATION_MINUTES,
      ),
    );
  });
  const [customerNote, setCustomerNote] = useState(initial?.customerNote ?? "");
  const [internalNote, setInternalNote] = useState(initial?.internalNote ?? "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [allowOverride, setAllowOverride] = useState(false);

  const filteredCustomers = customers.filter((c) => {
    const q = query.trim();
    if (!q) return true;
    return c.name.includes(q) || c.phone.replace(/-/g, "").includes(q.replace(/-/g, ""));
  });

  const startAtIso = useMemo(
    () => combineLocalDateTime(date, start).toISOString(),
    [date, start],
  );
  const endAtIso = useMemo(
    () => combineLocalDateTime(date, end).toISOString(),
    [date, end],
  );

  const availability = useMemo(() => {
    if (!staffId || !loc || !date || !start || !end) return null;
    if (!(new Date(endAtIso) > new Date(startAtIso))) return null;
    return getStaffAvailability({
      organizationId,
      locationId: loc,
      staffId,
      startAt: startAtIso,
      endAt: endAtIso,
      ignoreAppointmentId: initial?.id,
      serviceId,
      appointments: listAppointments({ organizationId }),
    });
  }, [organizationId, loc, staffId, startAtIso, endAtIso, initial?.id, serviceId, date, start, end]);

  const suggested = useMemo(() => {
    if (!loc || !date || !start || !end) return [];
    if (!(new Date(endAtIso) > new Date(startAtIso))) return [];
    return findAvailableStaff({
      organizationId,
      locationId: loc,
      startAt: startAtIso,
      endAt: endAtIso,
      serviceId,
      ignoreAppointmentId: initial?.id,
      appointments: listAppointments({ organizationId }),
    });
  }, [organizationId, loc, startAtIso, endAtIso, serviceId, initial?.id, date, start, end]);

  function applyDuration(nextServiceId: string, nextStart: string, nextDate: string) {
    const svc = services.find((s) => s.id === nextServiceId);
    const minutes = svc?.durationMinutes ?? DEFAULT_SERVICE_DURATION_MINUTES;
    setEnd(formatHm(addMinutes(combineLocalDateTime(nextDate, nextStart), minutes)));
  }

  function save(force = false) {
    setError("");
    if (!customerId || !serviceId || !staffId || !loc || !date || !start || !end) {
      setError("請完整填寫顧客、服務、美容師、分店與時間");
      return;
    }
    if (!(new Date(endAtIso) > new Date(startAtIso))) {
      setError("結束時間必須晚於開始時間");
      return;
    }
    if (availability && !availability.available && !force && !allowOverride) {
      setError(describeAvailability(availability));
      return;
    }
    try {
      const payload = {
        locationId: loc,
        customerId,
        serviceId,
        staffId,
        startAt: startAtIso,
        endAt: endAtIso,
        customerNote,
        internalNote,
        createdBy: actorId,
        updatedBy: actorId,
        allowConflict: force || allowOverride,
      };
      if (initial) updateAppointment(organizationId, initial.id, payload);
      else createAppointment(organizationId, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^(CONFLICT|UNAVAILABLE):/, "") : "無法儲存");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-text/30 sm:items-center" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0" aria-label="關閉" onClick={onClose} />
      <Card
        ref={dialogRef}
        padding="lg"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto"
      >
        <h2 className="text-lg font-semibold text-text">{initial ? "編輯預約" : "新增預約"}</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-secondary-text">
            分店
            <select className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3" value={loc} onChange={(e) => setLoc(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-secondary-text">
            搜尋顧客
            <input className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="姓名或電話" />
          </label>
          <label className="block text-sm text-secondary-text">
            顧客
            <select aria-invalid={Boolean(error) && !customerId} className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">選擇顧客</option>
              {filteredCustomers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>
              ))}
            </select>
          </label>
          <Link href="/staff/customers/new" className="inline-flex min-h-11 items-center text-sm text-primary">建立新客戶</Link>
          <label className="block text-sm text-secondary-text">
            服務
            <select className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3" value={serviceId} onChange={(e) => { setServiceId(e.target.value); applyDuration(e.target.value, start, date); }}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes}分</option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-secondary-text">
            美容師
            <select className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {staff.map((s) => (
                <option key={s.userId} value={s.userId}>{s.displayName}</option>
              ))}
            </select>
          </label>
          {suggested.length > 0 ? (
            <div className="rounded-2xl bg-primary-light/40 px-3 py-2">
              <p className="text-xs text-secondary-text">可預約美容師</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {suggested.map((s) => (
                  <button
                    key={s.staffId}
                    type="button"
                    className="min-h-11 rounded-2xl bg-surface px-3 text-sm text-text"
                    onClick={() => setStaffId(s.staffId)}
                  >
                    {s.displayName}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            <label className="text-sm text-secondary-text">日期
              <input type="date" className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2" value={date} onChange={(e) => { setDate(e.target.value); applyDuration(serviceId, start, e.target.value); }} />
            </label>
            <label className="text-sm text-secondary-text">開始
              <input type="time" step={1800} className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2" value={start} onChange={(e) => { setStart(e.target.value); applyDuration(serviceId, e.target.value, date); }} />
            </label>
            <label className="text-sm text-secondary-text">結束
              <input type="time" step={1800} className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          {availability ? (
            <p
              className={cn(
                "text-sm",
                availability.available ? "text-secondary-text" : "text-[#B07A4A]",
              )}
              role={availability.available ? undefined : "alert"}
            >
              {describeAvailability(availability)}
            </p>
          ) : null}
          <label className="block text-sm text-secondary-text">客人備註
            <textarea className="mt-1 w-full rounded-2xl border border-border px-3 py-2" rows={2} value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} />
          </label>
          <label className="block text-sm text-secondary-text">內部備註
            <textarea className="mt-1 w-full rounded-2xl border border-border px-3 py-2" rows={2} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
          </label>
          {error ? <p className="text-sm text-[#B07A4A]" role="alert">{error}</p> : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>取消</Button>
          {availability && !availability.available ? (
            <Button
              className="min-h-11"
              onClick={() => {
                setAllowOverride(true);
                save(true);
              }}
            >
              仍要建立預約
            </Button>
          ) : (
            <Button className="min-h-11" onClick={() => save(false)}>儲存</Button>
          )}
        </div>
      </Card>
    </div>
  );
}

const ACTION_LABEL: Partial<Record<CanonicalAppointmentStatus, string>> = {
  CONFIRMED: "確認預約",
  ARRIVED: "客人已到",
  IN_SERVICE: "開始服務",
  CANCELLED: "取消",
  NO_SHOW: "未到",
  COMPLETED: "標記完成",
};

function AppointmentDetail({
  item,
  locationName,
  onClose,
  onEdit,
  onTransition,
}: {
  item: ScheduleAppointment;
  locationName?: string;
  onClose: () => void;
  onEdit: () => void;
  onTransition: (status: CanonicalAppointmentStatus) => void;
}) {
  const dialogRef = useDialogA11y(onClose);
  const customer = getCustomerById(item.customerId, item.organizationId);
  const actions = allowedTransitions(item.status).filter(
    (s) => s !== item.status && s !== "IN_SERVICE",
  );
  const canEdit = item.status === "BOOKED" || item.status === "CONFIRMED";
  const treatmentHref = `/staff/treatments/new?customer=${item.customerId}&appointment=${item.id}`;
  const checkoutEligible =
    item.status === "IN_SERVICE" || item.status === "COMPLETED";
  const alreadyPaid = hasCompletedTransactionForAppointment(
    item.organizationId,
    item.id,
  );
  const paidTx = alreadyPaid
    ? getCompletedTransactionForAppointment(item.organizationId, item.id)
    : undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-text/30 sm:items-center" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0" aria-label="關閉" onClick={onClose} />
      <Card ref={dialogRef} padding="lg" className="relative z-10 w-full max-w-md space-y-3">
        <h2 className="text-lg font-semibold text-text">{item.customerName}</h2>
        <p className="text-sm text-secondary-text">
          {STATUS_LABEL[item.status]}
          {locationName ? ` · ${locationName}` : null}
        </p>
        {customer?.phone ? (
          <p className="text-sm text-secondary-text">電話：{customer.phone}</p>
        ) : null}
        <p className="text-[15px] text-text">{item.serviceName} · {item.staffName}</p>
        <p className="text-sm text-secondary-text">
          {formatHm(new Date(item.startAt))}–{formatHm(new Date(item.endAt))} · {item.durationMinutes} 分
        </p>
        {item.customerNote ? <p className="text-sm">客人：{item.customerNote}</p> : null}
        {item.internalNote ? <p className="text-sm text-secondary-text">內部：{item.internalNote}</p> : null}
        <div className="flex flex-wrap gap-2">
          {canEdit ? <Button variant="outline" className="min-h-11" onClick={onEdit}>編輯</Button> : null}
          {actions.map((status) => (
            <Button key={status} className="min-h-11" variant="secondary" onClick={() => onTransition(status)}>
              {ACTION_LABEL[status] ?? STATUS_LABEL[status]}
            </Button>
          ))}
          {item.status === "ARRIVED" ? (
            <Link
              href={treatmentHref}
              className="inline-flex min-h-11 items-center rounded-2xl bg-primary px-4 text-sm text-white"
              onClick={() => onTransition("IN_SERVICE")}
            >
              開始服務
            </Link>
          ) : null}
          {item.status === "IN_SERVICE" ? (
            <Link
              href={treatmentHref}
              className="inline-flex min-h-11 items-center rounded-2xl bg-primary px-4 text-sm text-white"
            >
              前往療程
            </Link>
          ) : null}
          {checkoutEligible && !alreadyPaid ? (
            <Link
              href={`/staff/checkout?appointment=${item.id}`}
              className="inline-flex min-h-11 items-center rounded-2xl bg-primary px-4 text-sm text-white"
            >
              前往結帳
            </Link>
          ) : null}
          {alreadyPaid && paidTx ? (
            <Link
              href={`/staff/transactions?id=${paidTx.id}`}
              className="inline-flex min-h-11 items-center rounded-2xl bg-primary-light px-4 text-sm text-primary"
            >
              已結帳 · {paidTx.transactionNumber}
            </Link>
          ) : null}
          {item.status === "COMPLETED" ? (
            <Link
              href={`/staff/customers/${item.customerId}`}
              className="inline-flex min-h-11 items-center rounded-2xl bg-primary-light px-4 text-sm text-primary"
            >
              查看客戶
            </Link>
          ) : null}
        </div>
        <Button variant="ghost" className="min-h-11" onClick={onClose}>關閉</Button>
      </Card>
    </div>
  );
}
