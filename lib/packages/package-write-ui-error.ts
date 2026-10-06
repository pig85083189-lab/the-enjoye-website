/**
 * User-safe messages for the Package remote create pilot.
 * Never forwards raw PostgreSQL / PostgREST text to the UI.
 */

import { IdentityCatalogError, UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { REMOTE_DEMO_SERVICE_MESSAGE } from "@/lib/persistence/demo-firewall";
import {
  PACKAGE_WRITE_UNAUTHORIZED_MESSAGE,
  PackageWriteCreateOnlyError,
  PackageWritePilotOffError,
  PackageWriteUnauthorizedError,
} from "./package-write-guard";

export const PACKAGE_WRITE_UI = {
  unauthenticated: "尚未登入，無法建立遠端套票方案",
  mapping: "套票方案資料無法對應，未建立",
  unauthorized: "沒有權限管理套票方案",
  required: "請填寫套票名稱、堂數、售價與適用療程",
  demo: "示範或測試套票不能寫入遠端",
  network: "連線失敗，套票方案尚未確認",
  createOnly: "目前僅能新增套票方案",
  off: "遠端套票方案建立尚未開放",
  generic: "無法建立套票方案",
} as const;

function looksLikeDatabaseText(message: string): boolean {
  return /23505|duplicate key|unique constraint|violates|SQLSTATE|postgres|permission denied/i.test(
    message,
  );
}

export function packageWriteUserMessage(error: unknown): string {
  if (error instanceof PackageWritePilotOffError) return PACKAGE_WRITE_UI.off;
  if (error instanceof PackageWriteCreateOnlyError) return PACKAGE_WRITE_UI.createOnly;
  if (error instanceof PackageWriteUnauthorizedError) return PACKAGE_WRITE_UI.unauthorized;
  if (error instanceof UnmappedIdentityError) return PACKAGE_WRITE_UI.mapping;
  if (error instanceof IdentityCatalogError) {
    if (error.reason === "unauthenticated") return PACKAGE_WRITE_UI.unauthenticated;
    return PACKAGE_WRITE_UI.mapping;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes(PACKAGE_WRITE_UNAUTHORIZED_MESSAGE) ||
    /Unauthorized to manage package/i.test(message)
  ) {
    return PACKAGE_WRITE_UI.unauthorized;
  }
  if (
    message.includes("package name required") ||
    message.includes("sessionCount") ||
    message.includes("priceMinor") ||
    message.includes("package requires at least one service")
  ) {
    return PACKAGE_WRITE_UI.required;
  }
  if (message.includes(REMOTE_DEMO_SERVICE_MESSAGE) || /Demo \/ seed/i.test(message)) {
    return PACKAGE_WRITE_UI.demo;
  }
  if (/unmapped|fail-closed|cannot be resolved/i.test(message)) {
    return PACKAGE_WRITE_UI.mapping;
  }
  if (/timeout|network|fetch|abort|Failed to fetch|empty response/i.test(message)) {
    return PACKAGE_WRITE_UI.network;
  }
  if (looksLikeDatabaseText(message)) {
    return PACKAGE_WRITE_UI.generic;
  }
  return PACKAGE_WRITE_UI.generic;
}
