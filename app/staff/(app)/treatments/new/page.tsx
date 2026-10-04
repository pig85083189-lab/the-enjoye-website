import { Suspense } from "react";
import { TreatmentPageClient } from "@/features/treatments/TreatmentPageClient";
import { isAppointmentRemoteReadPilotEnabled } from "@/lib/appointments/appointment-remote-read-flag";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";

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
      />
    </Suspense>
  );
}
