import { connection } from "next/server";
import { TreatmentDetailReadonly } from "@/features/treatments/TreatmentDetailReadonly";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";
import { isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";

export default async function TreatmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  return (
    <div className="space-y-5">
    <TreatmentDetailReadonly
      treatmentId={id}
      customerRemoteReadPilot={isCustomerRemoteReadPilotEnabled()}
      treatmentRemoteReadPilot={isTreatmentRemoteReadPilotEnabled()}
    />
    </div>
  );
}
