import { connection } from "next/server";
import { MemberPublicationPanel } from "./MemberPublicationPanel";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
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
  const auth = await getAuthenticatedStaffMembership();
  const canPublish = auth.status === "ok" && ["OWNER","MANAGER"].includes(auth.membership.role);
  return (
    <div className="space-y-5">
    <TreatmentDetailReadonly
      treatmentId={id}
      customerRemoteReadPilot={isCustomerRemoteReadPilotEnabled()}
      treatmentRemoteReadPilot={isTreatmentRemoteReadPilotEnabled()}
    />
    {canPublish && <div id="member-publication" className="mx-auto max-w-3xl"><MemberPublicationPanel organizationId={auth.membership.organizationId} treatmentId={id}/></div>}
    </div>
  );
}
