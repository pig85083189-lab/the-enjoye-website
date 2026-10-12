/**
 * Channel-level Broadcast claim + official monthly quota snapshot.
 * Mirrors claim_line_broadcast_send after the Channel lock migration.
 * Does not send. Does not treat a Channel lock as quota confirmation.
 */
import {
  LINE_BROADCAST_DAILY_LIMIT,
  LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID,
  LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
  LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
  LINE_BROADCAST_ONESHOT_CHANNEL_ID,
} from "@/lib/line/line-flag";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { evaluateLineBroadcastOneshotPermit } from "@/lib/line/line-oneshot";
import { lineOfficialQuotaBlockMessage } from "@/lib/line/line-quota";
import type { LineDecisionReason, LineQuotaPublic } from "@/lib/line/line-types";

export const LINE_BROADCAST_QUOTA_SNAPSHOT_MAX_AGE_MS = 30_000;
export const LINE_BROADCAST_CHANNEL_LOCK_NAMESPACE = 870121;

export type LineBroadcastSendMode = "oneshot" | "formal";

export type LineBroadcastChannelUsagePublic = {
  readOk: boolean;
  channelId: string | null;
  consumedToday: number;
  orgConsumedToday: number;
  peerConsumedToday: number;
  inflight: boolean;
  peerOrganizationIds: string[];
  quotaConfirmed: false;
};

export type LineBroadcastChannelAccount = {
  organizationId: string;
  channelId: string;
  broadcastEnabled: boolean;
  formalRuntimeOpen: boolean;
  testRuntimeOpen: boolean;
  botDisplayName?: string | null;
  botBasicId?: string | null;
};

export type LineBroadcastChannelRow = {
  organizationId: string;
  requestId: string;
  status: string;
  sendClaimedAt?: string | null;
};

export type LineBroadcastChannelClaimState = {
  channelId: string;
  accounts: LineBroadcastChannelAccount[];
  rows: LineBroadcastChannelRow[];
  permits: Record<string, boolean>;
};

export function emptyLineBroadcastChannelUsage(): LineBroadcastChannelUsagePublic {
  return {
    readOk: false,
    channelId: null,
    consumedToday: 0,
    orgConsumedToday: 0,
    peerConsumedToday: 0,
    inflight: false,
    peerOrganizationIds: [],
    quotaConfirmed: false,
  };
}

export function parseLineBroadcastChannelUsage(
  payload: unknown,
): LineBroadcastChannelUsagePublic {
  const empty = emptyLineBroadcastChannelUsage();
  if (!payload || typeof payload !== "object") return empty;
  const row = payload as Record<string, unknown>;
  if (row.ok !== true) return empty;
  const peers = Array.isArray(row.peer_organization_ids)
    ? row.peer_organization_ids.map((id) => String(id))
    : [];
  const consumedToday = Number(row.consumed_today ?? 0);
  const orgConsumedToday = Number(row.org_consumed_today ?? 0);
  return {
    readOk: true,
    channelId: typeof row.channel_id === "string" ? row.channel_id : null,
    consumedToday: Number.isFinite(consumedToday) ? consumedToday : 0,
    orgConsumedToday: Number.isFinite(orgConsumedToday) ? orgConsumedToday : 0,
    peerConsumedToday: Math.max(
      Number(row.peer_consumed_today ?? consumedToday - orgConsumedToday),
      0,
    ),
    inflight: row.inflight === true,
    peerOrganizationIds: peers,
    quotaConfirmed: false,
  };
}

export function lineBroadcastChannelLockIsNotQuotaConfirmation(): true {
  return true;
}

export function lineBroadcastClientQuotaSnapshotIsUntrusted(): true {
  return true;
}

export function lineBroadcastQuotaSnapshotAllowsClaim(input: {
  quotaKnown: boolean;
  quotaRemaining: number | null;
  quotaCheckedAt?: string | null;
  nowMs?: number;
  maxAgeMs?: number;
}): { ok: true } | { ok: false; reason: "quota_exceeded"; message: string } {
  if (input.quotaKnown !== true) {
    return { ok: false, reason: "quota_exceeded", message: lineOfficialQuotaBlockMessage(null) };
  }
  const checkedAt = input.quotaCheckedAt ? Date.parse(input.quotaCheckedAt) : Number.NaN;
  const now = input.nowMs ?? Date.now();
  const maxAge = input.maxAgeMs ?? LINE_BROADCAST_QUOTA_SNAPSHOT_MAX_AGE_MS;
  if (!Number.isFinite(checkedAt) || now - checkedAt > maxAge || checkedAt - now > 5_000) {
    return { ok: false, reason: "quota_exceeded", message: lineOfficialQuotaBlockMessage(null) };
  }
  if (input.quotaRemaining !== null && input.quotaRemaining <= 0) {
    return {
      ok: false,
      reason: "quota_exceeded",
      message: "LINE 訊息額度不足，已停止發送",
    };
  }
  return { ok: true };
}

export function lineBroadcastClaimRpcPayload(input: {
  organizationId: string;
  broadcastId?: string | null;
  requestId: string;
  textBody: string;
  sendMode: LineBroadcastSendMode;
  quota: LineQuotaPublic;
  quotaCheckedAt: string;
}): {
  p_organization_id: string;
  p_broadcast_id: string | null;
  p_request_id: string;
  p_text_body: string;
  p_send_mode: LineBroadcastSendMode;
  p_quota_known: boolean;
  p_quota_remaining: number | null;
  p_quota_checked_at: string;
} {
  return {
    p_organization_id: input.organizationId,
    p_broadcast_id: input.broadcastId ?? null,
    p_request_id: input.requestId,
    p_text_body: input.textBody,
    p_send_mode: input.sendMode,
    p_quota_known: input.quota.known === true,
    p_quota_remaining:
      input.quota.known && input.quota.type === "limited" ? input.quota.remaining : null,
    p_quota_checked_at: input.quotaCheckedAt,
  };
}

function claimedOnChannel(rows: readonly LineBroadcastChannelRow[]): number {
  return rows.filter(
    (row) =>
      Boolean(row.sendClaimedAt) ||
      row.status === "accepted" ||
      row.status === "sending" ||
      row.status === "pending_confirmation",
  ).length;
}

function channelHasInflight(rows: readonly LineBroadcastChannelRow[]): boolean {
  return rows.some((row) => row.status === "sending" || row.status === "pending_confirmation");
}

/**
 * Serialized Channel-level Broadcast claim used by PostgreSQL concurrency tests.
 * Same order as the RPC: Channel lock → inflight → Channel daily → official
 * monthly snapshot. A held lock never means quota is confirmed.
 */
export function applyLineBroadcastChannelClaimStep(
  state: LineBroadcastChannelClaimState,
  input: {
    organizationId: string;
    requestId: string;
    textBody: string;
    sendMode: LineBroadcastSendMode;
    quotaKnown: boolean;
    quotaRemaining: number | null;
    quotaCheckedAt?: string | null;
    nowMs?: number;
    dailyLimit?: number;
    env?: NodeJS.Dict<string>;
  },
): {
  claimed: boolean;
  reason?: LineDecisionReason;
  quotaConfirmed: boolean;
  consumedToday: number;
  status: string;
} {
  const limit = input.dailyLimit ?? LINE_BROADCAST_DAILY_LIMIT;
  const account = state.accounts.find((row) => row.organizationId === input.organizationId);
  if (!account || account.channelId !== state.channelId) {
    return {
      claimed: false,
      reason: "not_configured",
      quotaConfirmed: false,
      consumedToday: claimedOnChannel(state.rows),
      status: "draft",
    };
  }

  if (input.sendMode === "oneshot") {
    const gate = evaluateLineBroadcastOneshotPermit({
      env: input.env,
      connectionPilotEnabled: true,
      organizationId: input.organizationId,
      channelId: account.channelId,
      botDisplayName: account.botDisplayName,
      botBasicId: account.botBasicId,
      textBody: input.textBody,
      runtimeOpen: account.testRuntimeOpen,
      permitAvailable: state.permits[input.organizationId] === true,
      requireText: true,
      requireIdentity: false,
    });
    if (!gate.ok) {
      return {
        claimed: false,
        reason: gate.reason,
        quotaConfirmed: false,
        consumedToday: claimedOnChannel(state.rows),
        status: "draft",
      };
    }
  } else {
    if (input.organizationId === LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID) {
      return {
        claimed: false,
        reason: "send_closed",
        quotaConfirmed: false,
        consumedToday: claimedOnChannel(state.rows),
        status: "draft",
      };
    }
    if (!account.broadcastEnabled || !account.formalRuntimeOpen) {
      return {
        claimed: false,
        reason: "send_closed",
        quotaConfirmed: false,
        consumedToday: claimedOnChannel(state.rows),
        status: "draft",
      };
    }
  }

  const existing = state.rows.find(
    (row) => row.organizationId === input.organizationId && row.requestId === input.requestId,
  );
  const status = existing?.status ?? "draft";
  if (status === "pending_confirmation" || status === "sending") {
    return {
      claimed: false,
      reason: "pending_confirmation",
      quotaConfirmed: false,
      consumedToday: claimedOnChannel(state.rows),
      status,
    };
  }
  if (status === "accepted" || status === "failed" || existing?.sendClaimedAt) {
    return {
      claimed: false,
      reason: "duplicate",
      quotaConfirmed: false,
      consumedToday: claimedOnChannel(state.rows),
      status,
    };
  }
  if (channelHasInflight(state.rows)) {
    return {
      claimed: false,
      reason: "pending_confirmation",
      quotaConfirmed: false,
      consumedToday: claimedOnChannel(state.rows),
      status,
    };
  }

  const consumedToday = claimedOnChannel(state.rows);
  if (consumedToday >= limit) {
    return {
      claimed: false,
      reason: "quota_exceeded",
      quotaConfirmed: false,
      consumedToday,
      status,
    };
  }

  const snapshot = lineBroadcastQuotaSnapshotAllowsClaim({
    quotaKnown: input.quotaKnown,
    quotaRemaining: input.quotaRemaining,
    quotaCheckedAt: input.quotaCheckedAt,
    nowMs: input.nowMs,
  });
  if (!snapshot.ok) {
    return {
      claimed: false,
      reason: snapshot.reason,
      quotaConfirmed: false,
      consumedToday,
      status,
    };
  }

  if (input.sendMode === "oneshot") {
    state.permits[input.organizationId] = false;
  }
  if (existing) {
    existing.status = "sending";
    existing.sendClaimedAt = new Date(input.nowMs ?? Date.now()).toISOString();
  } else {
    state.rows.push({
      organizationId: input.organizationId,
      requestId: input.requestId,
      status: "sending",
      sendClaimedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    });
  }
  return {
    claimed: true,
    quotaConfirmed: false,
    consumedToday: claimedOnChannel(state.rows),
    status: "sending",
  };
}

export function sharedChannelFixtureAccounts(
  channelId = LINE_BROADCAST_ONESHOT_CHANNEL_ID,
): LineBroadcastChannelAccount[] {
  return [
    {
      organizationId: LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID,
      channelId,
      broadcastEnabled: false,
      formalRuntimeOpen: false,
      testRuntimeOpen: true,
      botDisplayName: LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
      botBasicId: LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
    },
    {
      organizationId: ORG_ENJOYE_ID,
      channelId,
      broadcastEnabled: true,
      formalRuntimeOpen: true,
      testRuntimeOpen: false,
      botDisplayName: LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
      botBasicId: LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
    },
  ];
}
