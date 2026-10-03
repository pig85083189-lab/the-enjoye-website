import { CalendarPage } from "@/features/calendar/CalendarPage";
import { isAppointmentRemoteMutatePilotEnabled } from "@/lib/appointments/appointment-remote-mutate-flag";
import { isAppointmentRemoteWritePilotEnabled } from "@/lib/appointments/appointment-remote-write-flag";
import { isCalendarRemoteReadPilotEnabled } from "@/lib/appointments/calendar-remote-read-flag";

export default function StaffCalendarPage() {
  return (
    <CalendarPage
      calendarRemoteReadPilot={isCalendarRemoteReadPilotEnabled()}
      appointmentRemoteWritePilot={isAppointmentRemoteWritePilotEnabled()}
      appointmentRemoteMutatePilot={isAppointmentRemoteMutatePilotEnabled()}
    />
  );
}
