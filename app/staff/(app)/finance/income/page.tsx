import { connection } from "next/server";
import { FinanceIncomePageClient } from "@/features/finance/FinanceIncomePageClient";
import { isExpenseRemoteWritePilotEnabled } from "@/lib/finance/expense-remote-write-flag";
import { isFinanceRemoteReadPilotEnabled } from "@/lib/finance/finance-remote-read-flag";

export default async function FinanceIncomePage() {
  await connection();
  return (
    <FinanceIncomePageClient
      financeRemoteReadPilot={isFinanceRemoteReadPilotEnabled()}
      expenseRemoteWritePilot={isExpenseRemoteWritePilotEnabled()}
    />
  );
}
