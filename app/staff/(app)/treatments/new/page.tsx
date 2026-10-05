import { Suspense } from "react";
import { TreatmentPageClient } from "@/features/treatments/TreatmentPageClient";
import { isAppointmentRemoteReadPilotEnabled } from "@/lib/appointments/appointment-remote-read-flag";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";
import { isCommerceRemoteReadPilotEnabled } from "@/lib/commerce/commerce-remote-read-flag";
import { isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";
import { isTreatmentRemoteWritePilotEnabled } from "@/lib/treatments/treatment-remote-write-flag";

export default function NewTreatmentPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-secondary-text">
          載入療程工作區…
        </div>
      }
    >
      <TreatmentPageClient
        customerRemoteReadPilot={isCustomerRemoteReadPilotEnabled()}
        appointmentRemoteReadPilot={isAppointmentRemoteReadPilotEnabled()}
        treatmentRemoteReadPilot={isTreatmentRemoteReadPilotEnabled()}
        treatmentRemoteWritePilot={isTreatmentRemoteWritePilotEnabled()}
        commerceRemoteReadPilot={isCommerceRemoteReadPilotEnabled()}
      />
    </Suspense>
  );
}
