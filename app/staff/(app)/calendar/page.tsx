import { connection } from "next/server";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { isAppointmentRemoteMutatePilotEnabled } from "@/lib/appointments/appointment-remote-mutate-flag";
import { isAppointmentRemoteWritePilotEnabled } from "@/lib/appointments/appointment-remote-write-flag";
import { isCalendarRemoteReadPilotEnabled } from "@/lib/appointments/calendar-remote-read-flag";
import { isCommerceRemoteReadPilotEnabled } from "@/lib/commerce/commerce-remote-read-flag";
import { isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";

export default async function StaffCalendarPage() {
  await connection();
  return (
    <CalendarPage
      calendarRemoteReadPilot={isCalendarRemoteReadPilotEnabled()}
      appointmentRemoteWritePilot={isAppointmentRemoteWritePilotEnabled()}
      appointmentRemoteMutatePilot={isAppointmentRemoteMutatePilotEnabled()}
      treatmentRemoteReadPilot={isTreatmentRemoteReadPilotEnabled()}
      commerceRemoteReadPilot={isCommerceRemoteReadPilotEnabled()}
    />
  );
}
