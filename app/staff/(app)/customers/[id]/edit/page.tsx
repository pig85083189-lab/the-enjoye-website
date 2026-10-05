import { connection } from "next/server";
import { CustomerEditForm } from "@/features/customers/CustomerEditForm";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";

export default async function CustomerEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  return (
    <CustomerEditForm
      customerId={id}
      remoteReadPilot={isCustomerRemoteReadPilotEnabled()}
    />
  );
}
