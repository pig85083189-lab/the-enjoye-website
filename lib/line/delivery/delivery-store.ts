/**
 * Database contract for the shared LINE delivery ledger.
 * JavaScript Map is not the source of truth. Claim/complete live in SQL.
 * This module never calls LINE or opens send flags.
 */
export const ENQUEUE_LINE_DELIVERY_TASK_RPC = "enqueue_line_delivery_task";
export const CLAIM_LINE_DELIVERY_TASK_RPC = "claim_line_delivery_task";
export const COMPLETE_LINE_DELIVERY_TASK_RPC = "complete_line_delivery_task";
export const LINE_DELIVERY_BROADCAST_ELIGIBLE_RPC = "line_delivery_broadcast_eligible";

export const LINE_DELIVERY_DB_STATUSES = [
  "planned",
  "claimed",
  "blocked",
  "accepted",
  "failed",
  "pending_confirmation",
] as const;

export const LINE_DELIVERY_DB_NEVER_RESEND_STATUSES = [
  "claimed",
  "accepted",
  "pending_confirmation",
] as const;

export type LineDeliveryDbStatus = (typeof LINE_DELIVERY_DB_STATUSES)[number];
