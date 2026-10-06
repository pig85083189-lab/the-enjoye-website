/**
 * User-safe messages for the Service remote create pilot.
 * Never forwards raw PostgreSQL / PostgREST text to the UI.
 */

import { IdentityCatalogError, UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { REMOTE_DEMO_SERVICE_MESSAGE } from "@/lib/persistence/demo-firewall";
import {
  SERVICE_WRITE_UNAUTHORIZED_MESSAGE,
  ServiceWriteCreateOnlyError,
  ServiceWritePilotOffError,
  ServiceWriteUnauthorizedError,
} from "./service-write-guard";

export const SERVICE_WRITE_UI = {
  unauthenticated: "尚未登入，無法建立遠端服務",
  mapping: "服務資料無法對應，未建立",
  unauthorized: "沒有權限管理服務項目",
  required: "請填寫服務名稱、時長與售價",
  demo: "示範或測試服務不能寫入遠端",
  network: "連線失敗，服務尚未確認",
  createOnly: "目前僅能新增服務",
  off: "遠端服務建立尚未開放",
  generic: "無法建立服務",
} as const;

function looksLikeDatabaseText(message: string): boolean {
  return /23505|duplicate key|unique constraint|violates|SQLSTATE|postgres|permission denied/i.test(
    message,
  );
}

export function serviceWriteUserMessage(error: unknown): string {
  if (error instanceof ServiceWritePilotOffError) return SERVICE_WRITE_UI.off;
  if (error instanceof ServiceWriteCreateOnlyError) return SERVICE_WRITE_UI.createOnly;
  if (error instanceof ServiceWriteUnauthorizedError) return SERVICE_WRITE_UI.unauthorized;
  if (error instanceof UnmappedIdentityError) return SERVICE_WRITE_UI.mapping;
  if (error instanceof IdentityCatalogError) {
    if (error.reason === "unauthenticated") return SERVICE_WRITE_UI.unauthenticated;
    return SERVICE_WRITE_UI.mapping;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(SERVICE_WRITE_UNAUTHORIZED_MESSAGE) || /Unauthorized to manage services/i.test(message)) {
    return SERVICE_WRITE_UI.unauthorized;
  }
  if (
    message.includes("service name required") ||
    message.includes("durationMinutes") ||
    message.includes("priceMinor")
  ) {
    return SERVICE_WRITE_UI.required;
  }
  if (message.includes(REMOTE_DEMO_SERVICE_MESSAGE)) {
    return SERVICE_WRITE_UI.demo;
  }
  if (/unmapped|fail-closed|cannot be resolved/i.test(message)) {
    return SERVICE_WRITE_UI.mapping;
  }
  if (/timeout|network|fetch|abort|Failed to fetch|empty response/i.test(message)) {
    return SERVICE_WRITE_UI.network;
  }
  if (looksLikeDatabaseText(message)) {
    return SERVICE_WRITE_UI.generic;
  }
  return SERVICE_WRITE_UI.generic;
}
