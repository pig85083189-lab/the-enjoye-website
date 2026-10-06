import { connection } from "next/server";
import { FinanceReportsPageClient } from "@/features/finance/FinanceReportsPageClient";
import { isExpenseRemoteWritePilotEnabled } from "@/lib/finance/expense-remote-write-flag";
import { isFinanceRemoteReadPilotEnabled } from "@/lib/finance/finance-remote-read-flag";

export default async function FinanceReportsPage() {
  await connection();
  return (
    <FinanceReportsPageClient
      financeRemoteReadPilot={isFinanceRemoteReadPilotEnabled()}
      expenseRemoteWritePilot={isExpenseRemoteWritePilotEnabled()}
    />
  );
}
