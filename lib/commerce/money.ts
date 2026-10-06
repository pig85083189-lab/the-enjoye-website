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

/** Format TWD minor units as NT$2,300. Negatives are -NT$60,200, never NT$-60,200. */
export function formatTwd(amountMinor: number, currency = DEFAULT_CURRENCY): string {
  const n = Number.isFinite(amountMinor) ? Math.trunc(amountMinor) : 0;
  const abs = Math.abs(n).toLocaleString("en-US");
  const sign = n < 0 ? "-" : "";
  if (currency !== "TWD") {
    return `${sign}${currency} ${abs}`;
  }
  return `${sign}NT$${abs}`;
}

/** Parse user input digits to integer minor units. Rejects decimals. */
export function parseMoneyInput(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) return null;
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}
