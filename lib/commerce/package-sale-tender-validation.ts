/**
 * Server-side validation for a dedicated package sale payment request.
 * Amounts are integer minor units, never floating point TWD amounts.
 * This validation must run before the finance service-role RPC.
 */
export type PackageSaleTender = {
  method: "CASH" | "CARD" | "TRANSFER" | "OTHER";
  amount: number;
  reference?: string;
};
const ALLOWED = new Set(["CASH", "CARD", "TRANSFER", "OTHER"]);
export function validatePackageSaleTenders(
  input: unknown,
  expectedTotalMinor: number,
): PackageSaleTender[] {
  if (!Number.isSafeInteger(expectedTotalMinor) || expectedTotalMinor <= 0) {
    throw new Error("套票應收金額無效");
  }
  if (!Array.isArray(input) || input.length < 1 || input.length > 4) {
    throw new Error("請提供有效付款方式");
  }
  const tenders: PackageSaleTender[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("付款資料格式錯誤");
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).some(key => !["method", "amount", "reference"].includes(key))) {
      throw new Error("付款資料包含未允許欄位");
    }
    if (typeof row.method !== "string" || !ALLOWED.has(row.method) || seen.has(row.method)) {
      throw new Error("付款方式無效或重複");
    }
    if (typeof row.amount !== "number" || !Number.isSafeInteger(row.amount) || row.amount <= 0) {
      throw new Error("付款金額無效");
    }
    if (row.reference !== undefined && (typeof row.reference !== "string" || row.reference.length > 128)) {
      throw new Error("付款參考資料無效");
    }
    seen.add(row.method);
    total += row.amount;
    if (!Number.isSafeInteger(total) || total > expectedTotalMinor) throw new Error("付款金額與應收金額不符");
    tenders.push({
      method: row.method as PackageSaleTender["method"],
      amount: row.amount,
      ...(typeof row.reference === "string" ? { reference: row.reference } : {}),
    });
  }
  if (total !== expectedTotalMinor) throw new Error("付款金額與應收金額不符");
  return tenders;
}
