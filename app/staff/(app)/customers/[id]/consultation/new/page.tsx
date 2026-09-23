import { ConsultationWizard } from "@/features/customers/ConsultationWizard";

export default async function NewConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConsultationWizard mode="existing" customerId={id} />;
}
