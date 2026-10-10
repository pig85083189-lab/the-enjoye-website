import { connection } from "next/server";
import { FinanceDashboardPageClient } from "@/features/finance/FinanceDashboardPageClient";
import { isExpenseRemoteWritePilotEnabled } from "@/lib/finance/expense-remote-write-flag";
import { isFinanceRemoteReadPilotEnabled } from "@/lib/finance/finance-remote-read-flag";

export default async function FinancePage() {
  await connection();
  return (
    <FinanceDashboardPageClient
      financeRemoteReadPilot={isFinanceRemoteReadPilotEnabled()}
      expenseRemoteWritePilot={isExpenseRemoteWritePilotEnabled()}
    />
  );
}
