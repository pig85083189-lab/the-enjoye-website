import { connection } from "next/server";
import { TransactionsPageClient } from "@/features/transactions/TransactionsPageClient";
import { isCommerceRemoteReadPilotEnabled } from "@/lib/commerce/commerce-remote-read-flag";

export default async function TransactionsPage() {
  await connection();
  return (
    <TransactionsPageClient
      commerceRemoteReadPilot={isCommerceRemoteReadPilotEnabled()}
    />
  );
}
