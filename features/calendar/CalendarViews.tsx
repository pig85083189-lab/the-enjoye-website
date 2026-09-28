"use client";

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
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
import { isAppointmentKeyboardActivation } from "@/lib/calendar/selection";
import { absoluteMinutesFromDate } from "@/lib/appointments/visible-range";
import { useClientNow } from "@/lib/use-client-now";
import { cn } from "@/lib/utils";
import type { StaffMembership } from "@/types/saas";
import { Card } from "@/components/ui/Card";
import { Coffee, Crown } from "lucide-react";
import { getServiceById } from "@/data/mock-services";
import {
  APPOINTMENT_INSET_CLASS,
  APPOINTMENT_RADIUS_CLASS,
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
  WORKSPACE_RADIUS_CLASS,
  addDays,
  layoutTimedBlock,
  serviceTypeCardTone,
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
            className={cn(
              "absolute right-2 text-[11px] font-medium tabular-nums text-secondary-text sm:text-xs",
              i === 0 ? "translate-y-0" : "-translate-y-1/2",
            )}
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
              isHour ? "border-[#D4C6C0]" : "border-[#E5DBD6]",
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
      className="pointer-events-none absolute left-0 right-0 z-[3] flex items-center"
      style={{ top }}
      aria-hidden
    >
      <span className="-translate-x-1 shrink-0 rounded-full bg-[#C9797D] px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-white">
        {formatNowHm(now)}
      </span>
      <span className="-ml-0.5 h-2 w-2 shrink-0 rounded-full bg-[#C9797D]" />
      <span className="h-px flex-1 bg-[#C9797D]" />
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
  const showTimeRange = height >= 36;
  const showService = height >= 48;
  const showDuration = height >= 64;
  const showStaff = !hideStaffName && height >= 96;
  const isVip = item.membership === "vip";
  const muted = item.status === "CANCELLED" || item.status === "NO_SHOW";
  const service = getServiceById(item.serviceId, item.organizationId);
  const typeTone = muted ? null : serviceTypeCardTone(service?.serviceType);
  const fillClass = muted
    ? STATUS_BLOCK_BG[item.status]
    : item.status === "COMPLETED"
      ? typeTone
        ? `${typeTone.bg} opacity-80`
        : STATUS_BLOCK_BG.COMPLETED
      : (typeTone?.bg ?? STATUS_BLOCK_BG[item.status]);
  const accentClass = muted
    ? STATUS_ACCENT[item.status]
    : item.status === "COMPLETED"
      ? STATUS_ACCENT.COMPLETED
      : (typeTone?.accent ?? STATUS_ACCENT[item.status]);
  const tooltip = [
    `${formatHm(new Date(item.startAt))}–${formatHm(new Date(item.endAt))}`,
    item.customerName,
    item.serviceName,
    hideStaffName ? null : item.staffName,
    STATUS_LABEL[item.status],
  ]
    .filter(Boolean)
    .join(" · ");

  function selectFromPointer(
    event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>,
  ) {
    if (event.button !== 0) return;
    // Prevent button focus inside `.calendar-body-scroll`. Chrome otherwise
    // scrollIntoViews the card between mousedown and mouseup, which cancels
    // the click and never opens Quick View.
    event.preventDefault();
    event.stopPropagation();
    onSelect(item);
  }

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (!isAppointmentKeyboardActivation(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(item);
  }

  return (
    <button
      type="button"
      data-appointment-id={item.id}
      onPointerDown={selectFromPointer}
      onMouseDown={selectFromPointer}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(item);
      }}
      onKeyDown={selectFromKeyboard}
      aria-label={tooltip}
      title={tooltip}
      className={cn(
        "absolute z-10 cursor-pointer overflow-hidden text-left pointer-events-auto",
        APPOINTMENT_INSET_CLASS,
        APPOINTMENT_RADIUS_CLASS,
        fillClass,
      )}
      style={{ top, height }}
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-[3px]", accentClass)}
        aria-hidden
      />
      <div className="flex h-full min-w-0 flex-col gap-px py-1 pl-2.5 pr-1.5">
        {showTimeRange ? (
          <p className="flex shrink-0 items-center gap-1 text-[11px] font-medium leading-tight tabular-nums text-text/80">
            <span className="truncate">
              {formatHm(new Date(item.startAt))}–{formatHm(new Date(item.endAt))}
            </span>
            {isVip ? (
              <Crown
                className="h-3 w-3 shrink-0 text-[#C9797D]"
                strokeWidth={1.75}
                aria-hidden
              />
            ) : null}
          </p>
        ) : (
          <p className="shrink-0 text-[11px] font-medium tabular-nums text-text/80">
            {formatHm(new Date(item.startAt))}
          </p>
        )}
        <p className="truncate text-[12px] font-semibold leading-tight text-text">
          {item.customerName}
        </p>
        {showService ? (
          <p className="truncate text-[11px] leading-tight text-secondary-text">
            {item.serviceName}
          </p>
        ) : null}
        {showDuration ? (
          <p className="truncate text-[11px] leading-tight text-secondary-text">
            {item.durationMinutes}分鐘
          </p>
        ) : null}
        {isVip && showDuration ? (
          <p className="truncate text-[10px] leading-tight text-primary">
            VIP會員
          </p>
        ) : null}
        {showStaff ? (
          <p className="truncate text-[11px] text-secondary-text">
            {item.staffName}
          </p>
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
      className="relative min-w-0 border-l border-[#D8CBC6]"
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
                className={cn(
                  "absolute overflow-hidden px-2 py-1 text-[11px] text-secondary-text",
                  APPOINTMENT_INSET_CLASS,
                  APPOINTMENT_RADIUS_CLASS,
                )}
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
            className={cn(
              "absolute flex items-start justify-between gap-1 overflow-hidden px-2 py-1 text-[11px] text-secondary-text",
              APPOINTMENT_INSET_CLASS,
              APPOINTMENT_RADIUS_CLASS,
            )}
            style={{
              ...BREAK_STYLE,
              top: layout.topPx,
              height: layout.heightPx,
            }}
          >
            <span className="font-medium whitespace-nowrap">
              {br.label ?? "午休時間"}
            </span>
            <Coffee className="mt-0.5 h-3 w-3 shrink-0 opacity-70" aria-hidden />
          </div>
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
                tabIndex={-1}
                aria-label={`在 ${staff.displayName} ${hm} 新增預約`}
                className="absolute left-0 right-0 z-0 opacity-0 hover:bg-primary/[0.05] hover:opacity-100 focus:bg-primary/[0.07] focus:opacity-100 focus:outline-none"
                style={{ top: i * CALENDAR_SLOT_PX, height: CALENDAR_SLOT_PX }}
                onClick={() => handleSlotClick(hm)}
              />
            );
          })
        : null}

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
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden border border-border/80 bg-surface",
        WORKSPACE_RADIUS_CLASS,
      )}
    >
      <div
        ref={scrollRef}
        className="calendar-body-scroll min-h-0 flex-1 overflow-auto overflow-anchor-none"
      >
        <div style={{ minWidth: minWidth ?? "100%" }}>
          <div
            data-calendar-staff-header
            className="sticky top-0 z-10 grid border-b border-border/60 bg-[#FFFCFA]/95 backdrop-blur-sm"
            style={{ gridTemplateColumns: columns }}
          >
            <div />
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
                  className="flex h-[115px] flex-col items-center justify-center border-l border-[#D8CBC6] px-2 py-2 text-center"
                >
                  <div
                    className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-primary/12 text-[13px] font-semibold text-primary"
                    aria-hidden
                  >
                    {s.displayName.slice(0, 1)}
                  </div>
                  <p className="mt-1.5 truncate text-[13px] font-semibold leading-tight text-text">
                    {s.displayName}
                  </p>
                  {meta ? (
                    <p
                      className={cn(
                        "mt-0.5 truncate text-[11px] leading-tight tabular-nums text-secondary-text",
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
                        "mt-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium",
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
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden border border-border/80 bg-surface",
        WORKSPACE_RADIUS_CLASS,
      )}
    >
      <div className="calendar-body-scroll min-h-0 flex-1 overflow-auto overflow-anchor-none">
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
      <div className="calendar-body-scroll max-h-[min(70vh,32rem)] overflow-auto overflow-anchor-none">
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
