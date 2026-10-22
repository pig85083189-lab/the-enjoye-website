/**
 * Database contract for the shared LINE delivery ledger.
 * JavaScript Map is not the source of truth. Claim/complete live in SQL.
 * This module never calls LINE or opens send flags.
 */
export const ENQUEUE_LINE_DELIVERY_TASK_RPC = "enqueue_line_delivery_task";
export const CLAIM_LINE_DELIVERY_TASK_RPC = "claim_line_delivery_task";
export const CLAIM_NEXT_LINE_DELIVERY_TASK_RPC = "claim_next_line_delivery_task";
export const COMPLETE_LINE_DELIVERY_TASK_RPC = "complete_line_delivery_task";
export const READ_LINE_DELIVERY_TASKS_RPC = "read_line_delivery_tasks";
export const LINE_DELIVERY_BROADCAST_ELIGIBLE_RPC = "line_delivery_broadcast_eligible";
export const LINE_DELIVERY_BROADCAST_QUOTA_USED_RPC = "line_delivery_broadcast_quota_used";
export const LINE_BROADCAST_CONSUMED_ON_TAIPEI_DAY_RPC = "line_broadcast_consumed_on_taipei_day";

/** Delivery quota counts official Broadcast consumption. Official claim does not count delivery tasks. */
export const LINE_DELIVERY_QUOTA_COUNTS_OFFICIAL_BROADCASTS = true;
export const LINE_OFFICIAL_BROADCAST_CONSUMED_COUNTS_DELIVERY_TASKS = false;

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
