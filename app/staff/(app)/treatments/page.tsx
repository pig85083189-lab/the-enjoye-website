import { TreatmentsListPageClient } from "@/features/treatments/TreatmentsListPageClient";
import { isAppointmentRemoteReadPilotEnabled } from "@/lib/appointments/appointment-remote-read-flag";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";
import { isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";

export default function TreatmentsIndexPage() {
  return (
    <TreatmentsListPageClient
      customerRemoteReadPilot={isCustomerRemoteReadPilotEnabled()}
      appointmentRemoteReadPilot={isAppointmentRemoteReadPilotEnabled()}
      treatmentRemoteReadPilot={isTreatmentRemoteReadPilotEnabled()}
    />
  );
}
