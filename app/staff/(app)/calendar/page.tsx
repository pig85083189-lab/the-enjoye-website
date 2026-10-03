import { CalendarPage } from "@/features/calendar/CalendarPage";
import { isCalendarRemoteReadPilotEnabled } from "@/lib/appointments/calendar-remote-read-flag";

export default function StaffCalendarPage() {
  return (
    <CalendarPage calendarRemoteReadPilot={isCalendarRemoteReadPilotEnabled()} />
  );
}
