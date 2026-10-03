/**
 * User-safe messages for the Customer remote create pilot.
 * Never forwards raw PostgreSQL / PostgREST text to the UI.
 */

import { IdentityCatalogError, UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { REMOTE_DEMO_CUSTOMER_MESSAGE } from "@/lib/persistence/demo-firewall";
import {
  CustomerDuplicateError,
  CustomerWriteCreateOnlyError,
  CustomerWritePilotOffError,
} from "./customer-write-guard";

export const CUSTOMER_WRITE_UI = {
  unauthenticated: "尚未登入，無法建立遠端客戶",
  mapping: "客戶資料無法對應，未建立",
  location: "分店不屬於目前機構，未建立",
  duplicate: "此電話已有客戶，未重複建立",
  required: "請填寫姓名與電話",
  demo: "示範客戶不能寫入遠端",
  network: "連線失敗，客戶尚未確認",
  createOnly: "目前僅能新增客戶",
  off: "遠端客戶建立尚未開放",
  generic: "無法建立客戶",
} as const;

function looksLikeDatabaseText(message: string): boolean {
  return /23505|duplicate key|unique constraint|violates|SQLSTATE|postgres|permission denied/i.test(
    message,
  );
}

export function customerWriteUserMessage(error: unknown): string {
  if (error instanceof CustomerWritePilotOffError) return CUSTOMER_WRITE_UI.off;
  if (error instanceof CustomerWriteCreateOnlyError) return CUSTOMER_WRITE_UI.createOnly;
  if (error instanceof CustomerDuplicateError) return CUSTOMER_WRITE_UI.duplicate;
  if (error instanceof UnmappedIdentityError) {
    if (error.kind === "location") return CUSTOMER_WRITE_UI.location;
    return CUSTOMER_WRITE_UI.mapping;
  }
  if (error instanceof IdentityCatalogError) {
    if (error.reason === "unauthenticated") return CUSTOMER_WRITE_UI.unauthenticated;
    return CUSTOMER_WRITE_UI.mapping;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("姓名為必填") || message.includes("電話為必填")) {
    return CUSTOMER_WRITE_UI.required;
  }
  if (message.includes(REMOTE_DEMO_CUSTOMER_MESSAGE)) {
    return CUSTOMER_WRITE_UI.demo;
  }
  if (/unmapped|fail-closed|cannot be resolved/i.test(message)) {
    return CUSTOMER_WRITE_UI.mapping;
  }
  if (/timeout|network|fetch|abort|Failed to fetch|empty response/i.test(message)) {
    return CUSTOMER_WRITE_UI.network;
  }
  if (looksLikeDatabaseText(message)) {
    return CUSTOMER_WRITE_UI.generic;
  }
  return CUSTOMER_WRITE_UI.generic;
}
