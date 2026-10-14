/**
 * Future server-side Owner-self quota adapter. SEND stays closed.
 * Official LINE quota only. No client overwrite. Phase 2E-9 never
 * calls LINE and never writes a snapshot, even if a token is present.
 */

import { LINE_BOT_INFO_PATH, LINE_QUOTA_CONSUMPTION_PATH, LINE_QUOTA_PATH } from "@/lib/line/line-command";
import {
  LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
  LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
} from "@/lib/line/line-flag";
import { unknownLineQuota } from "@/lib/line/line-quota";
import type { LineQuotaPublic } from "@/lib/line/line-types";
import {
  OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
  type OwnerSelfTrustedQuotaSnapshot,
  evaluateOwnerSelfTrustedQuota,
} from "@/lib/line/automations/appointment-reminder-owner-self-push";

export const OWNER_SELF_REMINDER_QUOTA_SNAPSHOT_MAX_AGE_MS = 30_000;

export const OWNER_SELF_REMINDER_QUOTA_ADAPTER = {
  officialQuotaPath: LINE_QUOTA_PATH,
  officialConsumptionPath: LINE_QUOTA_CONSUMPTION_PATH,
  officialBotInfoPath: LINE_BOT_INFO_PATH,
  expectedChannelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
  expectedBotBasicId: LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
  expectedBotDisplayName: LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
  maxAgeMs: OWNER_SELF_REMINDER_QUOTA_SNAPSHOT_MAX_AGE_MS,
  clientQuotaAccepted: false,
  testConstantsForbidden: true,
  thisPhaseCallsLine: false,
  tokenSource: "server_official_account_secret",
} as const;

export function verifyOwnerSelfReminderQuotaChannel(input: {
  channelId: string;
  botBasicId?: string | null;
  botDisplayName?: string | null;
}): { ok: true } | { ok: false; reason: "quota_exceeded"; message: string } {
  if (input.channelId !== OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID) {
    return { ok: false, reason: "quota_exceeded", message: "LINE 額度快照與授權 Channel 不符" };
  }
  if (
    !input.botBasicId ||
    input.botBasicId !== LINE_BROADCAST_ONESHOT_BOT_BASIC_ID ||
    (input.botDisplayName != null && input.botDisplayName !== LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME)
  ) {
    return { ok: false, reason: "quota_exceeded", message: "LINE Channel 與授權測試帳號不一致" };
  }
  return { ok: true };
}

export function prepareOwnerSelfReminderQuotaSnapshot(input: {
  channelId: string;
  quota?: LineQuotaPublic | null;
  checkedAt?: string | null;
  clientQuota?: LineQuotaPublic | null;
  nowMs?: number;
}):
  | { ok: true; snapshot: OwnerSelfTrustedQuotaSnapshot }
  | { ok: false; reason: "quota_exceeded"; message: string } {
  if (input.clientQuota) {
    return { ok: false, reason: "quota_exceeded", message: "不能信任呼叫端自填的 LINE 額度" };
  }
  if (input.channelId !== OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID) {
    return { ok: false, reason: "quota_exceeded", message: "LINE 額度快照與授權 Channel 不符" };
  }
  if (!input.quota?.known || !input.checkedAt) {
    return { ok: false, reason: "quota_exceeded", message: "LINE 額度未知時拒絕發送" };
  }
  const snapshot: OwnerSelfTrustedQuotaSnapshot = {
    source: "service_role_snapshot",
    channelId: input.channelId,
    known: true,
    remaining: input.quota.type === "limited" ? input.quota.remaining : null,
    checkedAt: input.checkedAt,
  };
  const allowed = evaluateOwnerSelfTrustedQuota({
    snapshot,
    nowMs: input.nowMs,
  });
  if (!allowed.ok) return allowed;
  return { ok: true, snapshot };
}

export async function loadOwnerSelfReminderOfficialQuota(input: {
  channelId: string;
  accessToken?: string | null;
  clientQuota?: LineQuotaPublic | null;
  botBasicId?: string | null;
  botDisplayName?: string | null;
}): Promise<LineQuotaPublic> {
  if (typeof window !== "undefined") {
    throw new Error("Owner-self quota adapter cannot run in the browser");
  }
  if (input.clientQuota) {
    return unknownLineQuota("不能信任呼叫端自填的 LINE 額度");
  }
  const channel = verifyOwnerSelfReminderQuotaChannel({
    channelId: input.channelId,
    botBasicId: input.botBasicId ?? LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
    botDisplayName: input.botDisplayName ?? LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
  });
  if (!channel.ok) return unknownLineQuota(channel.message);
  if (input.accessToken?.trim()) {
    return unknownLineQuota("本階段不查詢 LINE 額度，即使已有伺服器憑證也不呼叫");
  }
  return unknownLineQuota("本階段不查詢 LINE 額度");
}
