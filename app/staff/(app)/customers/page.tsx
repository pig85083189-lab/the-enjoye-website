import { connection } from "next/server";
import { CustomerListPage } from "@/features/customers/CustomerListPage";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";
import { isCustomerRemoteWritePilotEnabled } from "@/lib/customers/customer-remote-write-flag";

export default async function CustomersPage() {
  await connection();
  return (
    <CustomerListPage
      remoteReadPilot={isCustomerRemoteReadPilotEnabled()}
      remoteWritePilot={isCustomerRemoteWritePilotEnabled()}
    />
  );
}
