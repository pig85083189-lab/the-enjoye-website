import { connection } from "next/server";
import { FinanceExpensesPageClient } from "@/features/finance/FinanceExpensesPageClient";
import { isExpenseRemoteWritePilotEnabled } from "@/lib/finance/expense-remote-write-flag";
import { isFinanceRemoteReadPilotEnabled } from "@/lib/finance/finance-remote-read-flag";

export default async function FinanceExpensesPage() {
  await connection();
  return (
    <FinanceExpensesPageClient
      financeRemoteReadPilot={isFinanceRemoteReadPilotEnabled()}
      expenseRemoteWritePilot={isExpenseRemoteWritePilotEnabled()}
    />
  );
}
