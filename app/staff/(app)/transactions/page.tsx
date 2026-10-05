import { TransactionsPageClient } from "@/features/transactions/TransactionsPageClient";
import { isCommerceRemoteReadPilotEnabled } from "@/lib/commerce/commerce-remote-read-flag";

export default function TransactionsPage() {
  return (
    <TransactionsPageClient
      commerceRemoteReadPilot={isCommerceRemoteReadPilotEnabled()}
    />
  );
}
