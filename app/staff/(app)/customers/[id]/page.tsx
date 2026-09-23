import { CustomerProfilePage } from "@/features/customers/CustomerProfilePage";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerProfilePage customerId={id} />;
}
