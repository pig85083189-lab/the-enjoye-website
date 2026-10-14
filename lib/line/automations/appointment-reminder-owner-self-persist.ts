/**
 * Preview Owner-self grant persist helpers. SEND stays closed.
 * Authenticated RPCs only. Never calls claim, quota, arm, or LINE.
 */

import {
  OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
  OWNER_SELF_REMINDER_PURPOSE,
  type OwnerSelfReminderGrant,
  type OwnerSelfReminderOneshot,
} from "@/lib/line/automations/appointment-reminder-owner-self-push";

export const GRANT_LINE_OWNER_SELF_REMINDER_TEST_RPC = "grant_line_owner_self_reminder_test";
export const REVOKE_LINE_OWNER_SELF_REMINDER_TEST_RPC = "revoke_line_owner_self_reminder_test";
export const ISSUE_LINE_OWNER_SELF_REMINDER_ONESHOT_RPC = "issue_line_owner_self_reminder_oneshot";

export type OwnerSelfGrantRpcResult = {
  ok?: boolean;
  reason?: string;
  message?: string;
  grant_id?: string;
  oneshot_id?: string;
  expires_at?: string;
  revoked?: boolean;
};

export function mapOwnerSelfGrantRow(
  row: Record<string, unknown> | null | undefined,
): OwnerSelfReminderGrant | null {
  if (!row?.id || typeof row.id !== "string" || !row.id.startsWith("lorg-")) return null;
  if (row.organization_id !== "org-beauty-os-test") return null;
  if (row.channel_id !== OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID) return null;
  if (row.purpose !== OWNER_SELF_REMINDER_PURPOSE) return null;
  return {
    id: row.id,
    organizationId: String(row.organization_id),
    staffUserId: String(row.staff_user_id ?? ""),
    channelId: String(row.channel_id),
    purpose: String(row.purpose),
    appointmentId: String(row.appointment_id ?? ""),
    bindBoundAt: String(row.bind_bound_at ?? ""),
    bindHint: String(row.bind_hint ?? ""),
    bindKeyId: String(row.bind_key_id ?? ""),
    acknowledgedOnceOnly: row.acknowledged_once_only === true,
    createdAt: String(row.created_at ?? ""),
    expiresAt: String(row.expires_at ?? ""),
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    authorizedViaTestPush: row.authorized_via_test_push === true,
  };
}

export function mapOwnerSelfOneshotRow(
  row: Record<string, unknown> | null | undefined,
): OwnerSelfReminderOneshot | null {
  if (!row?.id || typeof row.id !== "string" || !row.id.startsWith("laros-")) return null;
  const status = String(row.status ?? "");
  if (
    status !== "issued" &&
    status !== "claimed" &&
    status !== "accepted" &&
    status !== "pending_confirmation" &&
    status !== "expired" &&
    status !== "canceled"
  ) {
    return null;
  }
  return {
    id: row.id,
    grantId: String(row.grant_id ?? ""),
    organizationId: String(row.organization_id ?? ""),
    staffUserId: String(row.staff_user_id ?? ""),
    channelId: String(row.channel_id ?? ""),
    appointmentId: String(row.appointment_id ?? ""),
    bindBoundAt: String(row.bind_bound_at ?? ""),
    bindHint: typeof row.bind_hint === "string" ? row.bind_hint : undefined,
    bindKeyId: typeof row.bind_key_id === "string" ? row.bind_key_id : undefined,
    status,
    expiresAt: String(row.expires_at ?? ""),
    claimedAt: typeof row.claimed_at === "string" ? row.claimed_at : null,
    consumedAt: typeof row.consumed_at === "string" ? row.consumed_at : null,
  };
}

export function interpretOwnerSelfGrantRpc(
  value: unknown,
): OwnerSelfGrantRpcResult {
  if (!value || typeof value !== "object") return { ok: false, reason: "error", message: "授權回應無效" };
  return value as OwnerSelfGrantRpcResult;
}
