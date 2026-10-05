import { connection } from "next/server";
import { ConsultationWizard } from "@/features/customers/ConsultationWizard";
import { isCustomerRemoteWritePilotEnabled } from "@/lib/customers/customer-remote-write-flag";

export default async function NewCustomerPage() {
  await connection();
  return <ConsultationWizard mode="new" remoteWritePilot={isCustomerRemoteWritePilotEnabled()} />;
}
