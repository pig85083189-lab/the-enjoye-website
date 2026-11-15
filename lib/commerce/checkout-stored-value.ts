/**
 * Checkout display of the canonical Beauty OS stored-value account.
 * The balance route is the only client source. Settle still rechecks in Postgres.
 */

export type RemoteStoredValueWallet =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "active"; balanceMinor: number }
  | { status: "not_created" }
  | { status: "unbound" }
  | { status: "unavailable" };

export function remoteStoredValueWalletFromBalanceResponse(
  statusCode: number,
  body: unknown,
): RemoteStoredValueWallet {
  const code =
    body && typeof body === "object" && "code" in body
      ? String((body as { code?: unknown }).code ?? "")
      : "";
  if (statusCode === 403 && code === "LINE_LINK_REQUIRED") return { status: "unbound" };
  if (statusCode !== 200 || !body || typeof body !== "object") return { status: "unavailable" };
  const record = body as { status?: unknown; balanceMinor?: unknown };
  if (record.status === "not_created") return { status: "not_created" };
  if (
    record.status === "active" &&
    typeof record.balanceMinor === "number" &&
    Number.isSafeInteger(record.balanceMinor) &&
    record.balanceMinor >= 0
  ) {
    return { status: "active", balanceMinor: record.balanceMinor };
  }
  return { status: "unavailable" };
}

export function remoteStoredValueStatusLabel(wallet: RemoteStoredValueWallet): string {
  switch (wallet.status) {
    case "active":
      return "可使用儲值金付款";
    case "unbound":
      return "必須先完成 LINE 會員綁定";
    case "not_created":
      return "尚未建立正式儲值帳戶";
    case "unavailable":
      return "正式餘額查詢失敗，請稍後再試";
    case "idle":
    case "loading":
      return "正在查詢正式儲值餘額";
  }
}

/** Null when this stored-value amount may be saved. Amount 0 means the tender is unused. */
export function remoteStoredValueBlockReason(
  wallet: RemoteStoredValueWallet,
  amountMinor: number,
): string | null {
  if (amountMinor <= 0) return null;
  if (wallet.status !== "active") return remoteStoredValueStatusLabel(wallet);
  if (amountMinor > wallet.balanceMinor) return "儲值金餘額不足";
  return null;
}
