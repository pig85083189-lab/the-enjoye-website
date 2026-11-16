/**
 * Booking receipt and finance debit are different databases.
 * The receipt is claimed as PENDING before the debit. It becomes POSTED only
 * after the finance call returns the same effect key. A definite finance
 * rejection rolls its own transaction back, and the receipt is then FAILED.
 * A timeout leaves the receipt PENDING so the next attempt can replay the
 * idempotent debit and post the same receipt. POSTED is never abandoned.
 */

const DEFINITE_FINANCE_REJECTIONS = [
  "儲值金扣款金額必須大於零",
  "沒有權限結帳",
  "必須先完成顧客身分對應",
  "顧客帳號無效",
  "必須先完成 LINE 會員綁定",
  "找不到有效儲值帳戶",
  "儲值金扣款未入帳，請勿重複結帳",
  "儲值金餘額不足",
] as const;

export function storedValueEffectKey(checkoutAppId: string): string {
  return `booking-checkout:${checkoutAppId}`;
}

export function financeDebitWasRejected(message: string): boolean {
  return DEFINITE_FINANCE_REJECTIONS.some((item) => message.includes(item));
}

export function receiptInstallIsMissing(error: { code?: string } | null | undefined): boolean {
  const code = error?.code;
  return code === "PGRST205" || code === "42P01" || code === "PGRST202" || code === "42883";
}

type ReceiptStatus = "PENDING" | "POSTED";

export async function completeStoredValueDebit(steps: {
  expectedEffectKey: string;
  claim(): Promise<ReceiptStatus>;
  debit(): Promise<{ effectKey?: string }>;
  commit(): Promise<void>;
  abandon(): Promise<void>;
}): Promise<"POSTED"> {
  const claimed = await steps.claim();
  if (claimed === "POSTED") return "POSTED";
  try {
    const settled = await steps.debit();
    if (settled.effectKey !== steps.expectedEffectKey) {
      throw new Error("儲值金扣款尚未對上收據，請再試一次");
    }
    await steps.commit();
    return "POSTED";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (financeDebitWasRejected(message)) {
      try {
        await steps.abandon();
      } catch {
        // The finance transaction already rolled back. Keep the original rejection.
      }
    }
    throw error;
  }
}
