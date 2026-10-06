import { connection } from "next/server";
import { TreatmentsListPageClient } from "@/features/treatments/TreatmentsListPageClient";
import { isAppointmentRemoteReadPilotEnabled } from "@/lib/appointments/appointment-remote-read-flag";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";
import { isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";
import { isCommerceRemoteReadPilotEnabled } from "@/lib/commerce/commerce-remote-read-flag";

export default async function TreatmentsIndexPage() {
  await connection();
  return (
    <TreatmentsListPageClient
      customerRemoteReadPilot={isCustomerRemoteReadPilotEnabled()}
      appointmentRemoteReadPilot={isAppointmentRemoteReadPilotEnabled()}
      treatmentRemoteReadPilot={isTreatmentRemoteReadPilotEnabled()}
      commerceRemoteReadPilot={isCommerceRemoteReadPilotEnabled()}
    />
  );
}
