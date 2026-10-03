import { ConsultationWizard } from "@/features/customers/ConsultationWizard";
import { isCustomerRemoteWritePilotEnabled } from "@/lib/customers/customer-remote-write-flag";

export default function NewCustomerPage() {
  return <ConsultationWizard mode="new" remoteWritePilot={isCustomerRemoteWritePilotEnabled()} />;
}
