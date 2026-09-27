"use client";

import { useEffect, useRef } from "react";
import {
  CALENDAR_SLOT_MINUTES,
  CALENDAR_SLOT_PX,
} from "@/lib/appointments/calendar-config";
import {
  STATUS_LABEL,
  combineLocalDateTime,
  formatHm,
  formatYmd,
  startOfDay,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import {
  describeAvailability,
  getStaffAvailability,
} from "@/lib/staff-schedule/availability";
import {
  dayOfWeekLocal,
  parseHmToMinutes,
  type StaffBreak,
  type StaffTimeOff,
} from "@/lib/staff-schedule/domain";
import {
  getWorkingHoursForDay,
  listBreaks,
  listTimeOff,
} from "@/lib/staff-schedule/store";
import {
  formatNowHm,
  isTodayYmd,
  nowLineTopPx,
  resolveDayViewScrollTop,
  shouldShowNowLine,
} from "@/lib/calendar/now-line";
import {
  formatStaffDayHeaderMeta,
  resolveStaffDayScheduleStatus,
} from "@/lib/calendar/schedule-status";
import { absoluteMinutesFromDate } from "@/lib/appointments/visible-range";
import { useClientNow } from "@/lib/use-client-now";
import { cn } from "@/lib/utils";
import type { StaffMembership } from "@/types/saas";
import { Card } from "@/components/ui/Card";
import {
  DAY_MINUTES_END,
  DAY_MINUTES_START,
  GRID_HEIGHT,
  OFF_HOURS_STYLE,
  BREAK_STYLE,
  TIME_OFF_STYLE,
  STATUS_ACCENT,
  STATUS_BLOCK_BG,
  STAFF_DAY_HEADER_STICKY_PX,
  TIME_COL_PX,
  TOTAL_SLOTS,
  WEEKDAY,
  addDays,
  layoutTimedBlock,
  staffGridMinWidth,
  staffGridTemplate,
} from "./grid-shared";

function TimeAxis() {
  const labels = Array.from({ length: TOTAL_SLOTS + 1 }, (_, i) => {
    const minutes = DAY_MINUTES_START + i * CALENDAR_SLOT_MINUTES;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return {
      i,
      label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      hour: m === 0,
    };
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
            className="absolute right-2 -translate-y-1/2 text-[11px] font-medium tabular-nums text-secondary-text sm:text-xs"
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
              isHour ? "border-border/45" : "border-border/15",
            )}
            style={{ top: i * CALENDAR_SLOT_PX }}
          />
        );
      })}
    </div>
  );
}

function NowLine({ day }: { day: Date }) {
  const now = useClientNow();
  if (!shouldShowNowLine(day, now) || !now) return null;
  const top = nowLineTopPx({
    now,
    visibleStartMinutes: DAY_MINUTES_START,
    visibleEndMinutes: DAY_MINUTES_END,
    slotMinutes: CALENDAR_SLOT_MINUTES,
    slotPx: CALENDAR_SLOT_PX,
  });
  if (top == null) return null;
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-[3] flex items-center gap-1.5"
      style={{ top }}
      aria-hidden
    >
      <span className="shrink-0 text-[11px] font-semibold tabular-nums tracking-wide text-[#C9797D]">
        {formatNowHm(now)}
      </span>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#C9797D]" />
      <span className="h-px flex-1 bg-[#C9797D]/75" />
    </div>
  );
}

export function AppointmentBlock({
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
  const showTimeRange = height >= 48;
  const showService = height >= 56;
  const showDuration = height >= 76;
  const showStatus = height >= 96;
  const showStaff = !hideStaffName && height >= 112;
  const isVip = item.membership === "vip";
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
      className={cn(
        "absolute left-1.5 right-1.5 z-[1] overflow-hidden rounded-xl border border-[#E8DDD9]/80 text-left shadow-[0_1px_2px_rgba(48,43,43,0.04)]",
        STATUS_BLOCK_BG[item.status],
      )}
      style={{ top, height }}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-[3px] sm:w-1",
          STATUS_ACCENT[item.status],
        )}
        aria-hidden
      />
      <div className="flex h-full min-w-0 flex-col gap-0.5 py-1.5 pl-3 pr-2">
        {showTimeRange ? (
          <p className="shrink-0 text-[11px] font-medium tabular-nums leading-tight text-secondary-text sm:text-xs">
            {formatHm(new Date(item.startAt))} – {formatHm(new Date(item.endAt))}
          </p>
        ) : (
          <p className="shrink-0 text-[11px] font-medium tabular-nums text-secondary-text">
            {formatHm(new Date(item.startAt))}
          </p>
        )}
        <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold leading-snug text-text sm:text-sm">
          <span className="truncate">{item.customerName}</span>
          {isVip ? (
            <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
              VIP
            </span>
          ) : null}
        </p>
        {showService ? (
          <p className="truncate text-[12px] leading-snug text-secondary-text sm:text-[13px]">
            {item.serviceName}
          </p>
        ) : null}
        {showDuration ? (
          <p className="truncate text-[11px] text-secondary-text/90">
            {item.durationMinutes} 分鐘
          </p>
        ) : null}
        {showStaff ? (
          <p className="truncate text-[11px] text-secondary-text">
            {item.staffName}
          </p>
        ) : null}
        {showStatus ? (
          <span className="mt-auto inline-flex max-w-full truncate self-start rounded-md bg-surface/70 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-secondary-text ring-1 ring-border/60">
            {STATUS_LABEL[item.status]}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function StaffColumn({
  staff,
  organizationId,
  locationId,
  day,
  workingHours,
  breaks,
  timeOff,
  appointments,
  allAppointments,
  hideStaffName,
  onSelect,
  onEmptySlot,
  onBlockedSlot,
}: {
  staff: StaffMembership;
  organizationId: string;
  locationId: string;
  day: Date;
  workingHours: ReturnType<typeof getWorkingHoursForDay>;
  breaks: StaffBreak[];
  timeOff: StaffTimeOff[];
  appointments: ScheduleAppointment[];
  allAppointments: ScheduleAppointment[];
  hideStaffName?: boolean;
  onSelect: (item: ScheduleAppointment) => void;
  onEmptySlot: (hm: string) => void;
  onBlockedSlot: (message: string) => void;
}) {
  const workStart = workingHours?.isWorking
    ? parseHmToMinutes(workingHours.startTime)
    : null;
  const workEnd = workingHours?.isWorking
    ? parseHmToMinutes(workingHours.endTime)
    : null;
  const schedule = resolveStaffDayScheduleStatus({
    organizationId,
    locationId,
    staffId: staff.userId,
    day,
  });
  const noShift = workStart == null || workEnd == null;
  const dayYmd = formatYmd(day);

  function handleSlotClick(hm: string) {
    const startAt = combineLocalDateTime(dayYmd, hm).toISOString();
    const endDate = new Date(combineLocalDateTime(dayYmd, hm).getTime() + CALENDAR_SLOT_MINUTES * 60_000);
    const availability = getStaffAvailability({
      organizationId,
      locationId,
      staffId: staff.userId,
      startAt,
      endAt: endDate.toISOString(),
      appointments: allAppointments,
    });
    const blocked = availability.reasons.some((r) =>
      ["OUTSIDE_WORKING_HOURS", "BREAK", "TIME_OFF"].includes(r),
    );
    if (!availability.available && blocked) {
      onBlockedSlot(
        describeAvailability(availability) || "此時段不可預約",
      );
      return;
    }
    onEmptySlot(hm);
  }

  return (
    <div
      className="relative min-w-0 border-l border-border/25"
      style={{ height: GRID_HEIGHT }}
      role="gridcell"
      aria-label={`${staff.displayName} 時段`}
    >
      <SlotLines />
      {noShift ? (
        schedule.kind === "time_off" ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center px-3"
            style={TIME_OFF_STYLE}
          >
            <p className="text-sm font-semibold text-secondary-text">休假</p>
          </div>
        ) : (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center px-3"
            style={OFF_HOURS_STYLE}
          >
            <p className="text-sm font-semibold text-secondary-text">未排班</p>
          </div>
        )
      ) : (
        <>
          {workStart! > DAY_MINUTES_START ? (
            <div
              className="absolute left-0 right-0"
              style={{
                ...OFF_HOURS_STYLE,
                top: 0,
                height:
                  ((workStart! - DAY_MINUTES_START) / CALENDAR_SLOT_MINUTES) *
                  CALENDAR_SLOT_PX,
              }}
              aria-hidden
            />
          ) : null}
          {workEnd! < DAY_MINUTES_END ? (
            <div
              className="absolute left-0 right-0"
              style={{
                ...OFF_HOURS_STYLE,
                top:
                  ((workEnd! - DAY_MINUTES_START) / CALENDAR_SLOT_MINUTES) *
                  CALENDAR_SLOT_PX,
                bottom: 0,
              }}
              aria-hidden
            />
          ) : null}
        </>
      )}

      {schedule.kind !== "time_off" || !noShift
        ? timeOff.map((off) => {
            const layout = layoutTimedBlock(
              new Date(off.startAt),
              new Date(off.endAt),
            );
            if (!layout.visible) return null;
            return (
              <div
                key={off.id}
                className="absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-dashed border-border/70 px-2 py-1 text-[11px] text-secondary-text"
                style={{
                  ...TIME_OFF_STYLE,
                  top: layout.topPx,
                  height: layout.heightPx,
                }}
              >
                <span className="font-medium whitespace-nowrap">休假</span>
                {off.reason ? (
                  <span className="ml-1 line-clamp-1">{off.reason}</span>
                ) : null}
              </div>
            );
          })
        : null}

      {breaks.map((br) => {
        const layout = layoutTimedBlock(new Date(br.startAt), new Date(br.endAt));
        if (!layout.visible) return null;
        return (
          <div
            key={br.id}
            className="absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-[#E5D9CC]/90 px-2 py-1 text-[11px] text-secondary-text"
            style={{
              ...BREAK_STYLE,
              top: layout.topPx,
              height: layout.heightPx,
            }}
          >
            <span className="font-medium whitespace-nowrap">
              {br.label ?? "午休時間"}
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

      {!noShift
        ? Array.from({ length: TOTAL_SLOTS }, (_, i) => {
            const minutes = DAY_MINUTES_START + i * CALENDAR_SLOT_MINUTES;
            const hm = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
            return (
              <button
                key={hm}
                type="button"
                aria-label={`在 ${staff.displayName} ${hm} 新增預約`}
                className="absolute left-0 right-0 z-0 opacity-0 hover:bg-primary/[0.05] hover:opacity-100 focus:bg-primary/[0.07] focus:opacity-100 focus:outline-none"
                style={{ top: i * CALENDAR_SLOT_PX, height: CALENDAR_SLOT_PX }}
                onClick={() => handleSlotClick(hm)}
              />
            );
          })
        : null}
    </div>
  );
}

export function StaffDayGrid({
  day,
  organizationId,
  locationId,
  staff,
  appointments,
  onSelect,
  onEmptySlot,
  onBlockedSlot,
}: {
  day: Date;
  organizationId: string;
  locationId: string;
  staff: StaffMembership[];
  appointments: ScheduleAppointment[];
  onSelect: (item: ScheduleAppointment) => void;
  onEmptySlot: (staffId: string, hm: string) => void;
  onBlockedSlot: (message: string) => void;
}) {
  const dayYmd = formatYmd(day);
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const columns = staffGridTemplate(staff.length);
  const minWidth = staffGridMinWidth(staff.length);
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = useClientNow();
  const scrolledForDay = useRef<string | null>(null);

  useEffect(() => {
    if (!scrollRef.current || !now) return;
    if (!isTodayYmd(day, now)) return;
    if (scrolledForDay.current === dayYmd) return;
    scrolledForDay.current = dayYmd;
    const el = scrollRef.current;
    const headerEl = el.querySelector("[data-calendar-staff-header]");
    const stickyHeaderPx =
      headerEl instanceof HTMLElement
        ? headerEl.offsetHeight
        : STAFF_DAY_HEADER_STICKY_PX;
    const appointmentStartMinutes = appointments
      .filter((a) => formatYmd(new Date(a.startAt)) === dayYmd)
      .map((a) => absoluteMinutesFromDate(new Date(a.startAt)));
    el.scrollTop = resolveDayViewScrollTop({
      now,
      isToday: true,
      appointmentStartMinutes,
      visibleStartMinutes: DAY_MINUTES_START,
      visibleEndMinutes: DAY_MINUTES_END,
      slotMinutes: CALENDAR_SLOT_MINUTES,
      slotPx: CALENDAR_SLOT_PX,
      stickyHeaderPx,
      viewportPx: el.clientHeight,
    });
  }, [day, dayYmd, now, appointments]);

  if (staff.length === 0) {
    return (
      <Card padding="lg" className="text-center text-sm text-secondary-text">
        此分店目前沒有可排班美容師
      </Card>
    );
  }

  return (
    <div
      className="w-full overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-[0_1px_3px_rgba(48,43,43,0.04)]"
      style={{ maxHeight: "calc(100dvh - 14rem)" }}
    >
      <div
        ref={scrollRef}
        className="calendar-body-scroll h-full max-h-[inherit] overflow-auto"
      >
        <div style={{ minWidth: minWidth ?? "100%" }}>
          <div
            data-calendar-staff-header
            className="sticky top-0 z-10 grid border-b border-border/70 bg-[#FFFCFA]/95 backdrop-blur-sm"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="flex items-end justify-end px-2 pb-3 text-[11px] font-medium tabular-nums text-secondary-text">
              時間
            </div>
            {staff.map((s) => {
              const schedule = resolveStaffDayScheduleStatus({
                organizationId,
                locationId,
                staffId: s.userId,
                day,
                now,
              });
              const apptCount = appointments.filter(
                (a) =>
                  a.staffId === s.userId &&
                  formatYmd(new Date(a.startAt)) === dayYmd,
              ).length;
              const meta = formatStaffDayHeaderMeta(schedule, apptCount);
              return (
                <div
                  key={s.userId}
                  className="border-l border-border/25 px-3 py-3 text-center"
                >
                  <div
                    className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-primary"
                    aria-hidden
                  >
                    {s.displayName.slice(0, 1)}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-semibold text-text">
                    {s.displayName}
                  </p>
                  {meta ? (
                    <p
                      className={cn(
                        "mt-0.5 truncate text-xs tabular-nums text-secondary-text",
                        schedule.kind === "not_scheduled" &&
                          apptCount > 0 &&
                          "text-amber-800/80",
                      )}
                    >
                      {meta}
                    </p>
                  ) : null}
                  {schedule.dutyLabel ? (
                    <span
                      className={cn(
                        "mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                        schedule.dutyLabel === "上班中"
                          ? "bg-[#E8F3EC] text-[#4F7A5C]"
                          : "bg-[#F3EEEA] text-secondary-text",
                      )}
                    >
                      {schedule.dutyLabel}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="relative grid" style={{ gridTemplateColumns: columns }}>
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
                (a) =>
                  a.staffId === s.userId &&
                  formatYmd(new Date(a.startAt)) === dayYmd,
              );
              return (
                <StaffColumn
                  key={s.userId}
                  staff={s}
                  organizationId={organizationId}
                  locationId={locationId}
                  day={day}
                  workingHours={hours}
                  breaks={breaks}
                  timeOff={offs}
                  appointments={columnAppts}
                  allAppointments={appointments}
                  hideStaffName
                  onSelect={onSelect}
                  onEmptySlot={(hm) => onEmptySlot(s.userId, hm)}
                  onBlockedSlot={onBlockedSlot}
                />
              );
            })}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ left: TIME_COL_PX }}
            >
              <NowLine day={day} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WeekGrid({
  days,
  appointments,
  onSelect,
  now,
}: {
  days: Date[];
  appointments: ScheduleAppointment[];
  onSelect: (item: ScheduleAppointment) => void;
  now: Date | null;
}) {
  const columns = `${TIME_COL_PX}px repeat(7, minmax(0, 1fr))`;
  const weekMinWidth = TIME_COL_PX + 7 * 96;
  const todayYmd = now ? formatYmd(now) : null;

  return (
    <div
      className="w-full overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-[0_1px_3px_rgba(48,43,43,0.04)]"
      style={{ maxHeight: "calc(100dvh - 14rem)" }}
    >
      <div className="calendar-body-scroll h-full max-h-[inherit] overflow-auto">
        <div className="w-full" style={{ minWidth: weekMinWidth }}>
          <div
            className="sticky top-0 z-10 grid border-b border-border/70 bg-[#FFFCFA]/95 backdrop-blur-sm"
            style={{ gridTemplateColumns: columns }}
          >
            <div />
            {days.map((day) => {
              const ymd = formatYmd(day);
              const isToday = todayYmd === ymd;
              return (
                <div
                  key={ymd}
                  className={cn(
                    "border-l border-border/25 px-2 py-2.5 text-center text-xs font-semibold text-text sm:text-sm",
                    isToday && "bg-primary/[0.06]",
                  )}
                >
                  {WEEKDAY[day.getDay()]} {day.getMonth() + 1}/{day.getDate()}
                </div>
              );
            })}
          </div>
          <div className="relative grid" style={{ gridTemplateColumns: columns }}>
            <TimeAxis />
            {days.map((day) => {
              const ymd = formatYmd(day);
              const isToday = todayYmd === ymd;
              const dayAppts = appointments.filter(
                (a) => formatYmd(new Date(a.startAt)) === ymd,
              );
              return (
                <div
                  key={ymd}
                  className={cn(
                    "relative min-w-0 border-l border-border/25",
                    isToday && "bg-primary/[0.03]",
                  )}
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
                  {isToday ? <NowLine day={day} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mobile: single-staff day timeline */
export function MobileStaffDayView({
  day,
  organizationId,
  locationId,
  staff,
  appointments,
  onSelect,
  onEmptySlot,
  onBlockedSlot,
}: {
  day: Date;
  organizationId: string;
  locationId: string;
  staff: StaffMembership | null;
  appointments: ScheduleAppointment[];
  onSelect: (item: ScheduleAppointment) => void;
  onEmptySlot: (staffId: string, hm: string) => void;
  onBlockedSlot: (message: string) => void;
}) {
  if (!staff) {
    return (
      <Card padding="lg" className="text-center text-sm text-secondary-text">
        此分店目前沒有可排班美容師
      </Card>
    );
  }

  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const hours = getWorkingHoursForDay(
    organizationId,
    locationId,
    staff.userId,
    dayOfWeekLocal(day),
  );
  const breaks = listBreaks(organizationId, {
    locationId,
    staffId: staff.userId,
    from: dayStart,
    to: dayEnd,
  });
  const offs = listTimeOff(organizationId, {
    locationId,
    staffId: staff.userId,
    from: dayStart,
    to: dayEnd,
  }).filter((t) => t.status === "APPROVED");
  const schedule = resolveStaffDayScheduleStatus({
    organizationId,
    locationId,
    staffId: staff.userId,
    day,
  });
  const columnAppts = appointments.filter(
    (a) =>
      a.staffId === staff.userId &&
      formatYmd(new Date(a.startAt)) === formatYmd(day),
  );
  const meta = formatStaffDayHeaderMeta(schedule, columnAppts.length);

  return (
    <div className="overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-[0_1px_3px_rgba(48,43,43,0.04)]">
      <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-primary">
          {staff.displayName.slice(0, 1)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">{staff.displayName}</p>
          <p
            className={cn(
              "text-xs text-secondary-text",
              schedule.kind === "not_scheduled" &&
                columnAppts.length > 0 &&
                "text-amber-800/80",
            )}
          >
            {meta}
            {schedule.dutyLabel ? ` · ${schedule.dutyLabel}` : ""}
          </p>
        </div>
      </div>
      <div className="calendar-body-scroll max-h-[min(70vh,32rem)] overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: `${TIME_COL_PX}px minmax(0,1fr)` }}>
          <TimeAxis />
          <StaffColumn
            staff={staff}
            organizationId={organizationId}
            locationId={locationId}
            day={day}
            workingHours={hours}
            breaks={breaks}
            timeOff={offs}
            appointments={columnAppts}
            allAppointments={appointments}
            hideStaffName
            onSelect={onSelect}
            onEmptySlot={(hm) => onEmptySlot(staff.userId, hm)}
            onBlockedSlot={onBlockedSlot}
          />
        </div>
      </div>
    </div>
  );
}
