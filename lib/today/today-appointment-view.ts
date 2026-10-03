/**
 * Today presentation mapping from canonical ScheduleAppointment.
 * Not a second persistence model.
 */

import { scheduleAppointmentToLegacyView } from "@/lib/appointment-store";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { calendarAppointmentHm } from "@/lib/calendar/calendar-appointment-time";
import type { Appointment } from "@/types";

export function scheduleAppointmentToTodayView(
  item: ScheduleAppointment,
  useTaipeiTime: boolean,
): Appointment {
  const view = scheduleAppointmentToLegacyView(item);
  if (!useTaipeiTime) return view;
  return {
    ...view,
    time: calendarAppointmentHm(item.startAt, true),
  };
}
