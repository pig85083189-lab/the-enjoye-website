/**
 * Send-time recipient re-check. Job status `scheduled` is never sufficient.
 * Mirrors public.line_automation_send_recipient_allowed:
 * verified + active + confirmed_at + captured_at + webhook_code + secret.
 */
export type LineDeliveryRecipientSnapshot = {
  organizationId: string;
  customerId: string;
  verified: boolean;
  status: string | null;
  confirmedAt: string | null;
  capturedAt: string | null;
  bindMethod: string | null;
  hasSecret: boolean;
  customerStatus?: string | null;
};

export type LineDeliveryRecipientDecision =
  | { ok: true }
  | {
      ok: false;
      reason: "recipient_not_ready" | "blocked_invalid_identity";
      message: string;
    };

export function evaluateLineDeliveryRecipient(input: {
  organizationId: string;
  recipientId: string;
  snapshot: LineDeliveryRecipientSnapshot | null;
}): LineDeliveryRecipientDecision {
  const organizationId = input.organizationId.trim();
  const recipientId = input.recipientId.trim();
  if (!organizationId || !recipientId) {
    return {
      ok: false,
      reason: "blocked_invalid_identity",
      message: "缺少組織或顧客識別，不能發送",
    };
  }
  const snapshot = input.snapshot;
  if (
    !snapshot ||
    snapshot.organizationId !== organizationId ||
    snapshot.customerId !== recipientId
  ) {
    return {
      ok: false,
      reason: "recipient_not_ready",
      message: "發送前找不到對應的顧客 LINE 綁定",
    };
  }
  if (snapshot.customerStatus != null && snapshot.customerStatus !== "ACTIVE") {
    return {
      ok: false,
      reason: "recipient_not_ready",
      message: "顧客不是可發送狀態",
    };
  }
  const trusted =
    snapshot.verified === true &&
    snapshot.status === "active" &&
    Boolean(snapshot.confirmedAt) &&
    Boolean(snapshot.capturedAt) &&
    snapshot.bindMethod === "webhook_code" &&
    snapshot.hasSecret === true;
  if (!trusted) {
    return {
      ok: false,
      reason: "recipient_not_ready",
      message: "發送前重新檢查：顧客 LINE 綁定尚未成為可信任收件人",
    };
  }
  return { ok: true };
}
