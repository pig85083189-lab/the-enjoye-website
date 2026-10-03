import { formatYmd, type ScheduleAppointment } from "@/lib/appointments/domain";
import { calendarAppointmentYmd } from "@/lib/calendar/calendar-appointment-time";
import type { CalendarViewMode } from "@/lib/staff-schedule/prefs";

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function resolveSelectedAppointment(
  appointments: ScheduleAppointment[],
  selectedId: string | null,
): ScheduleAppointment | null {
  if (!selectedId) return null;
  return appointments.find((item) => item.id === selectedId) ?? null;
}

export function isAppointmentInCalendarView(
  item: ScheduleAppointment,
  input: {
    view: CalendarViewMode;
    anchor: Date;
    weekStart: Date;
    useTaipeiTime?: boolean;
  },
): boolean {
  const ymd = calendarAppointmentYmd(item.startAt, Boolean(input.useTaipeiTime));
  if (input.view === "day") return ymd === formatYmd(input.anchor);
  const from = formatYmd(input.weekStart);
  const to = formatYmd(addDays(input.weekStart, 6));
  return ymd >= from && ymd <= to;
}

export function shouldResetCalendarSelection(input: {
  selectedId: string | null;
  appointments: ScheduleAppointment[];
  view: CalendarViewMode;
  anchor: Date;
  weekStart: Date;
  useTaipeiTime?: boolean;
}): boolean {
  if (!input.selectedId) return false;
  const item = resolveSelectedAppointment(input.appointments, input.selectedId);
  if (!item) return true;
  return !isAppointmentInCalendarView(item, input);
}

export function shouldRenderQuickView(input: {
  selected: ScheduleAppointment | null;
  editing: boolean;
  creating: boolean;
}): boolean {
  return Boolean(input.selected && !input.editing && !input.creating);
}

/** Desktop inline QV is CSS-driven (`min-[720px]`). 1536 must never count as mobile. */
export function isInlineQuickViewViewport(widthPx: number): boolean {
  return widthPx >= 720;
}

/** Native button activation keys — used when mouse preventDefault must not eat keyboard. */
export function isAppointmentKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}
