import { DEFAULT_CURRENCY } from "./domain";

/** Assert integer minor units (no floats). */
export function assertMoney(amount: number, label = "amount"): number {
  if (!Number.isInteger(amount)) {
    throw new Error(`${label} must be an integer minor unit`);
  }
  return amount;
}

export function assertNonNegativeMoney(amount: number, label = "amount"): number {
  assertMoney(amount, label);
  if (amount < 0) throw new Error(`${label} cannot be negative`);
  return amount;
}

/** Format TWD minor units as NT$2,300 */
export function formatTwd(amountMinor: number, currency = DEFAULT_CURRENCY): string {
  const n = Number.isFinite(amountMinor) ? Math.trunc(amountMinor) : 0;
  if (currency !== "TWD") {
    return `${currency} ${n.toLocaleString("en-US")}`;
  }
  return `NT$${n.toLocaleString("en-US")}`;
}

/** Parse user input digits to integer minor units. Rejects decimals. */
export function parseMoneyInput(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) return null;
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}
