/**
 * Phase 3 foundation: pure, fail-closed delivery planning.
 *
 * This module NEVER calls LINE, a database, or a network service. It cannot
 * unlock production sending. A separate, reviewed dispatcher must implement
 * atomic claiming, signed credentials, quotas, delivery and reconciliation.
 */
import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";

export type DeliveryKind = "broadcast" | "automation";
export type DeliveryDecision =
  | "blocked_send_closed"
  | "blocked_no_consent"
  | "blocked_unverified_recipient"
  | "blocked_duplicate"
  | "blocked_invalid_message"
  | "blocked_not_due"
  | "blocked_invalid_identity"
  | "ready_for_review";

export type DeliveryCandidate = {
  kind: DeliveryKind;
  organizationId: string;
  deliveryId: string;
  recipientId: string;
  message: string;
  /** Only a webhook-captured, owner-confirmed binding is eligible for automation. */
  recipientVerified: boolean;
  recipientConsented: boolean;
  scheduledAtMs: number;
};

export type DeliveryPlan = {
  decision: DeliveryDecision;
  deliveryKey: string | null;
  /** Always false until a separately reviewed production dispatcher exists. */
  sentLine: false;
};

const MAX_MESSAGE_LENGTH = 5000;

export function planLineDelivery(
  candidate: DeliveryCandidate,
  options: { nowMs: number; existingDeliveryKeys: ReadonlySet<string> },
): DeliveryPlan {
  const blocked = (decision: DeliveryDecision): DeliveryPlan => ({
    decision,
    deliveryKey: null,
    sentLine: false,
  });
  // The flags are deliberately immutable, code-level kill gates.
  if (
    (candidate.kind === "automation" && !Boolean(LINE_AUTOMATION_SEND_OPEN)) ||
    (candidate.kind === "broadcast" && !Boolean(LINE_BROADCAST_SEND_OPEN))
  ) {
    return blocked("blocked_send_closed");
  }
  if (
    !candidate.organizationId.trim() ||
    !candidate.deliveryId.trim() ||
    !candidate.recipientId.trim()
  ) return blocked("blocked_invalid_identity");
  if (!candidate.recipientConsented) return blocked("blocked_no_consent");
  if (candidate.kind === "automation" && !candidate.recipientVerified) {
    return blocked("blocked_unverified_recipient");
  }
  if (!candidate.message.trim() || candidate.message.length > MAX_MESSAGE_LENGTH) {
    return blocked("blocked_invalid_message");
  }
  if (!Number.isFinite(options.nowMs) || !Number.isFinite(candidate.scheduledAtMs)) {
    return blocked("blocked_not_due");
  }
  if (candidate.scheduledAtMs > options.nowMs) return blocked("blocked_not_due");

  // Length-prefixed segments prevent collisions when IDs contain separators.
  const parts = [candidate.kind, candidate.organizationId, candidate.deliveryId, candidate.recipientId];
  const deliveryKey = parts.map((part) => `${part.length}:${part}`).join("|");
  if (options.existingDeliveryKeys.has(deliveryKey)) return blocked("blocked_duplicate");
  return { decision: "ready_for_review", deliveryKey, sentLine: false };
}
