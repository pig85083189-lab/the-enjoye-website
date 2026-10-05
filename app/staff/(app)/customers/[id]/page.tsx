import { Suspense } from "react";
import { connection } from "next/server";
import { CustomerProfilePage } from "@/features/customers/CustomerProfilePage";
import { isAppointmentRemoteReadPilotEnabled } from "@/lib/appointments/appointment-remote-read-flag";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";
import { isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  return (
    <Suspense
      fallback={
        <div className="space-y-3">
          <div className="h-10 w-40 animate-pulse rounded-2xl bg-primary-light/50" />
          <div className="h-40 animate-pulse rounded-2xl bg-primary-light/40" />
        </div>
      }
    >
      <CustomerProfilePage
        customerId={id}
        remoteReadPilot={isCustomerRemoteReadPilotEnabled()}
        appointmentRemoteReadPilot={isAppointmentRemoteReadPilotEnabled()}
        treatmentRemoteReadPilot={isTreatmentRemoteReadPilotEnabled()}
      />
    </Suspense>
  );
}
