import { Suspense } from "react";
import { CustomerProfilePage } from "@/features/customers/CustomerProfilePage";
import { isAppointmentRemoteReadPilotEnabled } from "@/lib/appointments/appointment-remote-read-pilot";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-pilot";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
      />
    </Suspense>
  );
}
