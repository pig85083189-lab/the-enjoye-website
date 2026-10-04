import { TreatmentsListPageClient } from "@/features/treatments/TreatmentsListPageClient";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";

export default function TreatmentsIndexPage() {
  return (
    <TreatmentsListPageClient
      customerRemoteReadPilot={isCustomerRemoteReadPilotEnabled()}
    />
  );
}
