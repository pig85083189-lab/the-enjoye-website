import { CustomerEditForm } from "@/features/customers/CustomerEditForm";

export default async function CustomerEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerEditForm customerId={id} />;
}
