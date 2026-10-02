import { CustomerListPage } from "@/features/customers/CustomerListPage";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-pilot";

export default function CustomersPage() {
  return <CustomerListPage remoteReadPilot={isCustomerRemoteReadPilotEnabled()} />;
}
