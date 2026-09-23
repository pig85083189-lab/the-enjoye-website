import { TreatmentDetailReadonly } from "@/features/treatments/TreatmentDetailReadonly";

export default async function TreatmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TreatmentDetailReadonly treatmentId={id} />;
}
