import { TreatmentDetailReadonly } from "@/features/treatments/TreatmentDetailReadonly";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";

export default async function TreatmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <TreatmentDetailReadonly
      treatmentId={id}
      customerRemoteReadPilot={isCustomerRemoteReadPilotEnabled()}
    />
  );
}
