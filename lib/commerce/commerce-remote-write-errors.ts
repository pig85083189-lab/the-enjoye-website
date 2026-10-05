export const COMMERCE_WRITE_PILOT_OFF_MESSAGE =
  "Commerce remote write pilot is off";

export const COMMERCE_WRITE_FORBIDDEN_MESSAGE = "沒有權限結帳";

export const COMMERCE_STALE_WRITE_MESSAGE = "資料已更新，請重新整理後再試";

export const COMMERCE_PAYMENT_UNAVAILABLE_MESSAGE = "此付款方式目前尚未開放";

export const COMMERCE_MISSING_SERVICE_PRICE_MESSAGE =
  "服務價格尚未設定，無法結帳";

export const COMMERCE_PAYMENT_MISMATCH_MESSAGE = "付款金額與應收不符";

export const COMMERCE_TREATMENT_NOT_COMPLETED_MESSAGE =
  "療程尚未完成，無法結帳";

export const COMMERCE_GENERIC_FAILURE_MESSAGE = "目前無法完成結帳，請稍後再試";

export class CommerceWritePilotDeniedError extends Error {
  constructor(message = COMMERCE_WRITE_FORBIDDEN_MESSAGE) {
    super(message);
    this.name = "CommerceWritePilotDeniedError";
  }
}

export class CommerceWriteStaleError extends Error {
  constructor(message = COMMERCE_STALE_WRITE_MESSAGE) {
    super(message);
    this.name = "CommerceWriteStaleError";
  }
}

export class CommerceWriteNotFoundError extends Error {
  constructor(message = "找不到結帳資料") {
    super(message);
    this.name = "CommerceWriteNotFoundError";
  }
}

const ENGINEERING_LEAK =
  /supabase|postgrest|rls|rpc|pilot|postgres|permission denied|jwt|service.role/i;

export function toCommerceUserMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (!raw) return COMMERCE_GENERIC_FAILURE_MESSAGE;
  if (
    error instanceof CommerceWriteStaleError ||
    /stale|updated_at|重新整理/i.test(raw)
  ) {
    return COMMERCE_STALE_WRITE_MESSAGE;
  }
  if (
    error instanceof CommerceWritePilotDeniedError ||
    /沒有權限/.test(raw)
  ) {
    return COMMERCE_WRITE_FORBIDDEN_MESSAGE;
  }
  if (/尚未開放|STORED_VALUE|PACKAGE/.test(raw)) {
    return COMMERCE_PAYMENT_UNAVAILABLE_MESSAGE;
  }
  if (/價格尚未設定|price_minor|missing service price/i.test(raw)) {
    return COMMERCE_MISSING_SERVICE_PRICE_MESSAGE;
  }
  if (/付款金額|payment total mismatch/i.test(raw)) {
    return COMMERCE_PAYMENT_MISMATCH_MESSAGE;
  }
  if (/療程尚未完成|treatment.*(draft|cancelled|void)/i.test(raw)) {
    return COMMERCE_TREATMENT_NOT_COMPLETED_MESSAGE;
  }
  if (ENGINEERING_LEAK.test(raw) || raw === COMMERCE_WRITE_PILOT_OFF_MESSAGE) {
    return COMMERCE_GENERIC_FAILURE_MESSAGE;
  }
  return raw;
}
