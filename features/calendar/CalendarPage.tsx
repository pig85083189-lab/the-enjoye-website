"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  AppointmentQuickView,
  CancelAppointmentDialog,
} from "@/features/calendar/AppointmentQuickView";
import {
  MobileStaffDayView,
  StaffDayGrid,
  WeekGrid,
} from "@/features/calendar/CalendarViews";
import {
  addDays,
  CALENDAR_ROSE_FILL,
  CALENDAR_ROSE_HOVER,
  startOfWeek,
  WEEKDAY,
} from "@/features/calendar/grid-shared";
import {
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import { DEFAULT_SERVICE_DURATION_MINUTES } from "@/lib/appointments/calendar-config";
import {
  addMinutes,
  combineLocalDateTime,
  formatHm,
  formatYmd,
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
  resolveSelectedAppointment,
  shouldRenderQuickView,
  shouldResetCalendarSelection,
} from "@/lib/calendar/selection";
import {
  buildStaffWorkloadRows,
  computeTotalWorkload,
  formatWorkloadHours,
} from "@/lib/calendar/workload";
import {
  describeAvailability,
  findAvailableStaff,
  getStaffAvailability,
} from "@/lib/staff-schedule/availability";
import {
  getStaffScheduleRevision,
  listBookableStaff,
  subscribeStaffSchedule,
} from "@/lib/staff-schedule/store";
import {
  readCalendarViewPrefs,
  writeCalendarViewPrefs,
  type CalendarViewMode,
} from "@/lib/staff-schedule/prefs";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { getServicesForOrganization } from "@/data/mock-services";
import { selectableServicesForBooking } from "@/lib/services/service-catalog-derived";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { useClientNow } from "@/lib/use-client-now";
import { cn } from "@/lib/utils";
import type { StaffMembership } from "@/types/saas";

function useDialogA11y(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const root = ref.current;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
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

export interface CreatePrefill {
  staffId?: string;
  customerId?: string;
  serviceId?: string;
  dateYmd?: string;
  startHm?: string;
}

function formatDayTitle(day: Date): string {
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日(週${weekdays[day.getDay()]})`;
}

function formatWeekTitle(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${weekStart.getMonth() + 1}月${weekStart.getDate()}日 – ${end.getDate()}日`;
  }
  return `${weekStart.getMonth() + 1}月${weekStart.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
}

export function CalendarPage() {
  const { organization, currentLocation, locations, membership } =
    useOrganization();
  const revision = useSyncExternalStore(
    subscribeAppointments,
    getAppointmentStatusRaw,
    () => "",
  );
  const scheduleRev = useSyncExternalStore(
    subscribeStaffSchedule,
    getStaffScheduleRevision,
    () => "",
  );
  void revision;
  void scheduleRev;
  const now = useClientNow();

  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<CalendarViewMode>(() => {
    const prefs = readCalendarViewPrefs(organization.id);
    // Prefer day for ops workbench when no saved preference shape — keep saved week/day
    return prefs.desktopView;
  });
  const [mobileDay, setMobileDay] = useState(() => new Date());
  const [mobileStaffId, setMobileStaffId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [prefill, setPrefill] = useState<CreatePrefill | null>(null);
  const [staffFilter, setStaffFilter] = useState<string[]>([]);
  const [cancelTarget, setCancelTarget] = useState<ScheduleAppointment | null>(
    null,
  );
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);

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
  const rangeFrom = view === "week" ? weekStart : startOfDayLocal(anchor);
  const rangeTo =
    view === "week" ? addDays(weekStart, 6) : startOfDayLocal(anchor);
  const scheduleDay = view === "day" ? anchor : (now ?? anchor);
  const rangeFromYmd = formatYmd(rangeFrom);
  const rangeToYmd = formatYmd(rangeTo);
  const scheduleDayYmd = formatYmd(scheduleDay);

  const workloadRows = useMemo(
    () =>
      buildStaffWorkloadRows({
        staff: staffRoster,
        appointments,
        from: rangeFrom,
        toInclusive: rangeTo,
        organizationId: organization.id,
        locationId,
        scheduleDay,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by ymd strings
    [
      staffRoster,
      appointments,
      rangeFromYmd,
      rangeToYmd,
      organization.id,
      locationId,
      scheduleDayYmd,
      view,
    ],
  );
  const totalLoad = useMemo(
    () => computeTotalWorkload(appointments, rangeFrom, rangeTo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointments, rangeFromYmd, rangeToYmd],
  );

  function setViewPersisted(next: CalendarViewMode) {
    setView(next);
    writeCalendarViewPrefs(organization.id, { desktopView: next });
    setSelectedId(null);
  }

  function goToDay(next: Date) {
    setAnchor(next);
    setMobileDay(next);
    setSelectedId(null);
  }

  function openCreate(nextPrefill?: CreatePrefill) {
    setSelectedId(null);
    setEditing(false);
    setPrefill(nextPrefill ?? null);
    setCreating(true);
  }

  function selectAppointment(item: ScheduleAppointment) {
    setSelectedId(item.id);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") !== "1") return;
    const nextPrefill: CreatePrefill = {
      customerId: params.get("customer") || undefined,
      serviceId: params.get("service") || undefined,
      staffId: params.get("staff") || undefined,
    };
    const url = new URL(window.location.href);
    url.searchParams.delete("create");
    url.searchParams.delete("customer");
    url.searchParams.delete("service");
    url.searchParams.delete("staff");
    url.searchParams.delete("followUp");
    window.history.replaceState({}, "", url.pathname + url.search);
    queueMicrotask(() => {
      setSelectedId(null);
      setEditing(false);
      setPrefill(nextPrefill);
      setCreating(true);
    });
  }, [organization.id]);

  function toggleStaffFilter(staffId: string) {
    const next = staffFilter.includes(staffId)
      ? staffFilter.filter((id) => id !== staffId)
      : [...staffFilter, staffId];
    setStaffFilter(next);
    if (!selectedId) return;
    const item = appointments.find((row) => row.id === selectedId);
    if (item && next.length > 0 && !next.includes(item.staffId)) {
      setSelectedId(null);
    }
  }

  const filteredAppointments =
    staffFilter.length === 0
      ? appointments
      : appointments.filter((a) => staffFilter.includes(a.staffId));

  const resolved = resolveSelectedAppointment(filteredAppointments, selectedId);
  const selected =
    resolved &&
    !shouldResetCalendarSelection({
      selectedId,
      appointments: filteredAppointments,
      view,
      anchor,
      weekStart,
    })
      ? resolved
      : null;

  const mobileStaff =
    staffRoster.find((s) => s.userId === mobileStaffId) ??
    staffRoster[0] ??
    null;

  useEffect(() => {
    if (!blockedMsg) return;
    const id = window.setTimeout(() => setBlockedMsg(null), 3200);
    return () => window.clearTimeout(id);
  }, [blockedMsg]);

  const showQuickView = shouldRenderQuickView({
    selected,
    editing,
    creating,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 min-[720px]:gap-5">
      <div
        data-calendar-chrome
        className="flex shrink-0 flex-col gap-3 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-between min-[720px]:gap-4"
      >
        <header data-calendar-header className="shrink-0 space-y-0.5">
          <h1 className="text-[1.75rem] font-semibold leading-none tracking-tight text-text">
            行事曆
          </h1>
          <p className="pt-1.5 text-[13px] text-secondary-text">
            {currentLocation?.name ?? "分店"} · 週工作量
          </p>
        </header>

        <div
          data-calendar-toolbar
          className="flex shrink-0 flex-wrap items-center gap-2 min-[720px]:justify-end"
        >
          <Button
            variant="outline"
            className="h-8 min-h-8 shrink-0 rounded-full px-3.5 text-[13px]"
            onClick={() => goToDay(new Date())}
          >
            今天
          </Button>
          <div className="flex min-w-0 items-center gap-0.5">
            <Button
              variant="ghost"
              className="h-8 min-h-8 min-w-8 shrink-0 rounded-full px-1.5"
              aria-label="上一段"
              onClick={() =>
                goToDay(addDays(anchor, view === "week" ? -7 : -1))
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="min-w-0 truncate px-1 text-center text-[13px] font-medium tabular-nums text-text sm:px-1.5">
              {view === "week"
                ? formatWeekTitle(weekStart)
                : formatDayTitle(anchor)}
            </p>
            <Button
              variant="ghost"
              className="h-8 min-h-8 min-w-8 shrink-0 rounded-full px-1.5"
              aria-label="下一段"
              onClick={() =>
                goToDay(addDays(anchor, view === "week" ? 7 : 1))
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div
            className="hidden items-center gap-1.5 min-[720px]:flex"
            role="group"
            aria-label="檢視模式"
          >
            {(["day", "week"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                onClick={() => setViewPersisted(id)}
                className={cn(
                  "inline-flex h-8 min-h-8 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors",
                  view === id
                    ? cn(CALENDAR_ROSE_FILL, "text-white")
                    : "border border-border bg-surface text-secondary-text hover:bg-primary-light/40",
                )}
              >
                {id === "day" ? "日" : "週"}
              </button>
            ))}
          </div>
          <Button
            className={cn(
              "h-8 min-h-8 shrink-0 rounded-full px-3.5 text-[13px]",
              CALENDAR_ROSE_FILL,
              CALENDAR_ROSE_HOVER,
            )}
            onClick={() => openCreate()}
            aria-label="新增預約"
          >
            <Plus className="h-3.5 w-3.5" />
            新增預約
          </Button>
        </div>
      </div>

      <StaffWorkloadFilter
        staff={staffRoster}
        workloads={workloadRows}
        total={totalLoad}
        selected={staffFilter}
        dayView={view === "day"}
        onToggle={toggleStaffFilter}
        onClear={() => setStaffFilter([])}
      />

      {blockedMsg ? (
        <p
          className="rounded-2xl border border-[#E8DDD4] bg-[#F8F3EE] px-4 py-2.5 text-sm text-[#B07A4A]"
          role="status"
        >
          此時段不可預約 · {blockedMsg}
        </p>
      ) : null}

      {/* Mobile */}
      <div className="space-y-3 min-[720px]:hidden">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {weekDays.map((day) => {
            const active = formatYmd(day) === formatYmd(mobileDay);
            return (
              <button
                key={formatYmd(day)}
                type="button"
                onClick={() => goToDay(day)}
                className={cn(
                  "min-h-11 min-w-14 shrink-0 rounded-2xl px-3 text-sm",
                  active
                    ? "bg-primary text-white"
                    : "bg-surface text-text",
                )}
              >
                {WEEKDAY[day.getDay()]} {day.getDate()}
              </button>
            );
          })}
        </div>
        {staffRoster.length > 0 ? (
          <label className="block text-sm text-secondary-text">
            美容師
            <select
              className="mt-1 min-h-11 w-full rounded-2xl border border-border bg-surface px-3 text-text"
              value={mobileStaff?.userId ?? ""}
              onChange={(e) => setMobileStaffId(e.target.value)}
            >
              {staffRoster.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <MobileStaffDayView
          day={mobileDay}
          organizationId={organization.id}
          locationId={locationId}
          staff={mobileStaff}
          appointments={filteredAppointments}
          onSelect={selectAppointment}
          onEmptySlot={(staffId, hm) =>
            openCreate({
              staffId,
              dateYmd: formatYmd(mobileDay),
              startHm: hm,
            })
          }
          onBlockedSlot={setBlockedMsg}
        />
        <Button
          fullWidth
          className="min-h-11 sticky bottom-4"
          onClick={() =>
            openCreate({
              staffId: mobileStaff?.userId,
              dateYmd: formatYmd(mobileDay),
            })
          }
        >
          ＋ 新增預約
        </Button>
      </div>

      {/* Desktop / tablet workspace — calendar + inline Quick View, tops aligned */}
      <div
        data-calendar-workspace
        data-has-quickview={showQuickView ? "true" : "false"}
        className="hidden min-h-0 min-[720px]:flex min-[720px]:flex-1 min-[720px]:gap-4"
      >
        <div data-calendar-grid className="min-h-0 min-w-0 flex-1">
          {view === "day" ? (
            <StaffDayGrid
              day={anchor}
              organizationId={organization.id}
              locationId={locationId}
              staff={visibleStaff}
              appointments={filteredAppointments}
              onSelect={selectAppointment}
              onEmptySlot={(staffId, hm) =>
                openCreate({
                  staffId,
                  dateYmd: formatYmd(anchor),
                  startHm: hm,
                })
              }
              onBlockedSlot={setBlockedMsg}
            />
          ) : (
            <WeekGrid
              days={weekDays}
              appointments={filteredAppointments}
              onSelect={selectAppointment}
              now={now}
            />
          )}
        </div>
        {showQuickView && selected ? (
          <AppointmentQuickView
            item={selected}
            locationName={
              locations.find((l) => l.id === selected.locationId)?.name ??
              currentLocation?.name
            }
            onClose={() => setSelectedId(null)}
            onEdit={() => setEditing(true)}
            onRequestCancel={() => setCancelTarget(selected)}
            onTransition={(status) => {
              const next = transitionAppointmentStatus(
                organization.id,
                selected.id,
                status,
                membership?.userId,
              );
              setSelectedId(next.id);
            }}
          />
        ) : null}
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
            setSelectedId(null);
          }}
        />
      ) : null}

      {showQuickView && selected ? (
        <div className="min-[720px]:hidden">
          <AppointmentQuickView
            item={selected}
            locationName={
              locations.find((l) => l.id === selected.locationId)?.name ??
              currentLocation?.name
            }
            onClose={() => setSelectedId(null)}
            onEdit={() => setEditing(true)}
            onRequestCancel={() => setCancelTarget(selected)}
            onTransition={(status) => {
              const next = transitionAppointmentStatus(
                organization.id,
                selected.id,
                status,
                membership?.userId,
              );
              setSelectedId(next.id);
            }}
          />
        </div>
      ) : null}

      {cancelTarget ? (
        <CancelAppointmentDialog
          item={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onConfirm={() => {
            transitionAppointmentStatus(
              organization.id,
              cancelTarget.id,
              "CANCELLED",
              membership?.userId,
            );
            setCancelTarget(null);
            setSelectedId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function startOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function StaffWorkloadFilter({
  staff,
  workloads,
  total,
  selected,
  dayView,
  onToggle,
  onClear,
}: {
  staff: StaffMembership[];
  workloads: ReturnType<typeof buildStaffWorkloadRows>;
  total: { count: number; hours: number };
  selected: string[];
  dayView: boolean;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  if (staff.length === 0) return null;
  const byId = new Map(workloads.map((w) => [w.staffId, w]));

  return (
    <div
      data-calendar-workload
      className="flex shrink-0 gap-2 overflow-x-auto pb-0.5"
      role="group"
      aria-label="美容師篩選"
    >
      <button
        type="button"
        aria-pressed={selected.length === 0}
        onClick={onClear}
        className={cn(
          "flex h-[70px] shrink-0 flex-col justify-center rounded-2xl px-3.5 text-left transition-colors",
          selected.length === 0
            ? cn(CALENDAR_ROSE_FILL, "text-white")
            : "bg-surface text-text ring-1 ring-border hover:bg-primary-light/40",
        )}
      >
        <span className="block text-[13px] font-semibold leading-tight">
          全部美容師
        </span>
        <span className="mt-1.5 block text-[11px] leading-tight tabular-nums opacity-80">
          {total.count}筆 · {formatWorkloadHours(total.hours)}
        </span>
      </button>
      {staff.map((s) => {
        const active = selected.includes(s.userId);
        const load = byId.get(s.userId);
        return (
          <button
            key={s.userId}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(s.userId)}
            className={cn(
              "flex h-[70px] shrink-0 flex-col justify-center rounded-2xl px-3.5 text-left transition-colors",
              active
                ? cn(CALENDAR_ROSE_FILL, "text-white")
                : "bg-surface text-text ring-1 ring-border hover:bg-primary-light/40",
            )}
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  active
                    ? "bg-white/20 text-white"
                    : "bg-primary/12 text-primary",
                )}
                aria-hidden
              >
                {s.displayName.slice(0, 1)}
              </span>
              <span className="text-[13px] font-semibold leading-tight">
                {s.displayName}
              </span>
            </span>
            <span className="mt-1.5 block pl-9 text-[11px] leading-tight tabular-nums opacity-80">
              {load?.count ?? 0}筆 · {formatWorkloadHours(load?.hours ?? 0)}
              {dayView && load?.scheduleKind === "time_off"
                ? " · 休假"
                : dayView && load?.scheduleKind === "not_scheduled"
                  ? " · 未排班"
                  : ""}
            </span>
          </button>
        );
      })}
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
  const catalog = getServicesForOrganization(organizationId);
  const services = selectableServicesForBooking(
    catalog,
    initial?.serviceId ?? prefill?.serviceId,
  );
  const [loc, setLoc] = useState(initial?.locationId ?? locationId);
  const staff = staffOptionsForLocation(organizationId, loc);
  const [customerId, setCustomerId] = useState(
    initial?.customerId ?? prefill?.customerId ?? "",
  );
  const [serviceId, setServiceId] = useState(
    initial?.serviceId ?? prefill?.serviceId ?? services[0]?.id ?? "",
  );
  const [staffId, setStaffId] = useState(
    initial?.staffId ?? prefill?.staffId ?? staff[0]?.userId ?? "",
  );
  const [date, setDate] = useState(
    initial
      ? formatYmd(new Date(initial.startAt))
      : (prefill?.dateYmd ?? formatYmd(new Date())),
  );
  const [start, setStart] = useState(
    initial
      ? formatHm(new Date(initial.startAt))
      : (prefill?.startHm ?? "14:00"),
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
    return (
      c.name.includes(q) ||
      c.phone.replace(/-/g, "").includes(q.replace(/-/g, ""))
    );
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
  }, [
    organizationId,
    loc,
    staffId,
    startAtIso,
    endAtIso,
    initial?.id,
    serviceId,
    date,
    start,
    end,
  ]);

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
  }, [
    organizationId,
    loc,
    startAtIso,
    endAtIso,
    serviceId,
    initial?.id,
    date,
    start,
    end,
  ]);

  function applyDuration(
    nextServiceId: string,
    nextStart: string,
    nextDate: string,
  ) {
    const svc = services.find((s) => s.id === nextServiceId);
    const minutes =
      svc?.durationMinutes ?? DEFAULT_SERVICE_DURATION_MINUTES;
    setEnd(
      formatHm(
        addMinutes(combineLocalDateTime(nextDate, nextStart), minutes),
      ),
    );
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
      setError(
        err instanceof Error
          ? err.message.replace(/^(CONFLICT|UNAVAILABLE):/, "")
          : "無法儲存",
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-text/30 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0"
        aria-label="關閉"
        onClick={onClose}
      />
      <Card
        ref={dialogRef}
        padding="lg"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto"
      >
        <h2 className="text-lg font-semibold text-text">
          {initial ? "編輯預約" : "新增預約"}
        </h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-secondary-text">
            分店
            <select
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
              value={loc}
              onChange={(e) => setLoc(e.target.value)}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-secondary-text">
            搜尋顧客
            <input
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="姓名或電話"
            />
          </label>
          <label className="block text-sm text-secondary-text">
            顧客
            <select
              aria-invalid={Boolean(error) && !customerId}
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">選擇顧客</option>
              {filteredCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.phone}
                </option>
              ))}
            </select>
          </label>
          <Link
            href="/staff/customers/new"
            className="inline-flex min-h-11 items-center text-sm text-primary"
          >
            建立新客戶
          </Link>
          <label className="block text-sm text-secondary-text">
            服務
            <select
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                applyDuration(e.target.value, start, date);
              }}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.durationMinutes}分
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-secondary-text">
            美容師
            <select
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            >
              {staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.displayName}
                </option>
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
            <label className="text-sm text-secondary-text">
              日期
              <input
                type="date"
                className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  applyDuration(serviceId, start, e.target.value);
                }}
              />
            </label>
            <label className="text-sm text-secondary-text">
              開始
              <input
                type="time"
                step={1800}
                className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  applyDuration(serviceId, e.target.value, date);
                }}
              />
            </label>
            <label className="text-sm text-secondary-text">
              結束
              <input
                type="time"
                step={1800}
                className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          {availability ? (
            <p
              className={cn(
                "text-sm",
                availability.available
                  ? "text-secondary-text"
                  : "text-[#B07A4A]",
              )}
              role={availability.available ? undefined : "alert"}
            >
              {describeAvailability(availability)}
            </p>
          ) : null}
          <label className="block text-sm text-secondary-text">
            客人備註
            <textarea
              className="mt-1 w-full rounded-2xl border border-border px-3 py-2"
              rows={2}
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
            />
          </label>
          <label className="block text-sm text-secondary-text">
            內部備註
            <textarea
              className="mt-1 w-full rounded-2xl border border-border px-3 py-2"
              rows={2}
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
            />
          </label>
          {error ? (
            <p className="text-sm text-[#B07A4A]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose}>
            取消
          </Button>
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
            <Button className="min-h-11" onClick={() => save(false)}>
              儲存
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
