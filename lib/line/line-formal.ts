/**
 * Formal LINE Broadcast decisions for daily Owner use.
 * Does not send. Does not flip LINE_BROADCAST_SEND_OPEN.
 * TEST oneshot stays on the permit path.
 */
import {
  LINE_BROADCAST_DAILY_LIMIT,
  LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID,
  isLineBroadcastFormalEnvironmentOpen,
  isLineBroadcastFormalOpen,
} from "@/lib/line/line-flag";
import { canManageLineOfficialAccount } from "@/lib/line/line-roles";
import { lineQuotaBlocksSend, lineOfficialQuotaBlockMessage } from "@/lib/line/line-quota";
import type { LineActor } from "@/lib/line/line-command";
import type {
  LineDecisionReason,
  LineOfficialAccountPublic,
  LineQuotaPublic,
} from "@/lib/line/line-types";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

export type LineFormalIdentity = {
  clientId?: string | null;
  displayName?: string | null;
  basicId?: string | null;
};

export type LineFormalDecision =
  | { ok: true }
  | { ok: false; reason: LineDecisionReason; message: string };

export type LineFormalChannelPeer = {
  organizationId: string;
  channelId: string | null;
};

/** Known shared Messaging API Channel → the only org allowed to formal-send. */
export const LINE_BROADCAST_SHARED_CHANNEL_FORMAL_OWNERS: Readonly<Record<string, string>> = {
  "2009219238": ORG_ENJOYE_ID,
};

function refuse(reason: LineDecisionReason, message: string): Extract<LineFormalDecision, { ok: false }> {
  return { ok: false, reason, message };
}

export function lineBroadcastSharedChannelOwner(channelId?: string | null): string | null {
  const id = (channelId ?? "").trim();
  return id ? LINE_BROADCAST_SHARED_CHANNEL_FORMAL_OWNERS[id] ?? null : null;
}

export function lineBroadcastChannelRequiresCrossOrgLock(channelId?: string | null): boolean {
  return lineBroadcastSharedChannelOwner(channelId) !== null;
}

export function evaluateLineBroadcastSharedChannel(input: {
  organizationId?: string | null;
  channelId?: string | null;
  peers?: readonly LineFormalChannelPeer[];
  peerUsageKnown?: boolean;
  peerAcceptedToday?: number;
  acceptedToday?: number;
  dailyLimit?: number;
}): LineFormalDecision {
  const organizationId = (input.organizationId ?? "").trim();
  const channelId = (input.channelId ?? "").trim();
  if (!organizationId) {
    return refuse("unauthorized", "缺少店家識別");
  }
  if (!channelId) {
    return refuse("not_configured", "請先完成 LINE 官方帳號連線測試");
  }
  const designated = lineBroadcastSharedChannelOwner(channelId);
  if (designated && designated !== organizationId) {
    return refuse(
      "send_closed",
      "此 LINE Channel 已指定由另一間店家正式群發，避免對同一官方帳號重複發送",
    );
  }
  if (lineBroadcastChannelRequiresCrossOrgLock(channelId) && input.peerUsageKnown !== true) {
    return refuse(
      "send_closed",
      "無法確認同一官方帳號的跨店發送紀錄，已停止發送",
    );
  }
  const peers = input.peers ?? [];
  const foreignPeer = peers.some(
    (peer) =>
      (peer.channelId ?? "").trim() === channelId &&
      (peer.organizationId ?? "").trim() !== organizationId,
  );
  if (!designated && foreignPeer) {
    return refuse(
      "send_closed",
      "多間店家共用同一 LINE Channel，尚未指定正式群發店家",
    );
  }
  const limit = input.dailyLimit ?? LINE_BROADCAST_DAILY_LIMIT;
  const used = (input.acceptedToday ?? 0) + (input.peerAcceptedToday ?? 0);
  if (used >= limit) {
    return refuse("quota_exceeded", "同一官方帳號今日群發次數已達上限");
  }
  return { ok: true };
}

export function evaluateLineBroadcastFormalIdentity(input: {
  account: Pick<LineOfficialAccountPublic, "channelId" | "botDisplayName" | "botBasicId"> | null;
  identity?: LineFormalIdentity | null;
}): LineFormalDecision {
  const account = input.account;
  const identity = input.identity;
  if (
    !account?.channelId ||
    !account.botDisplayName ||
    !account.botBasicId ||
    !identity ||
    (identity.clientId ?? "").trim() !== account.channelId.trim() ||
    (identity.displayName ?? "").trim() !== account.botDisplayName.trim() ||
    (identity.basicId ?? "").trim() !== account.botBasicId.trim()
  ) {
    return refuse("not_configured", "LINE 官方帳號即時身分與已保存設定不一致");
  }
  return { ok: true };
}

export function evaluateLineBroadcastFormalReadiness(input: {
  env?: NodeJS.Dict<string>;
  connectionPilotEnabled: boolean;
  organizationId?: string | null;
  actor?: LineActor | null;
  account: LineOfficialAccountPublic | null;
  ownerBroadcastEnabled: boolean;
  accountConnected: boolean;
  peers?: readonly LineFormalChannelPeer[];
  peerUsageKnown?: boolean;
  peerAcceptedToday?: number;
  acceptedToday?: number;
  formalRuntimeOpen?: boolean;
  requireIdentity?: boolean;
  identity?: LineFormalIdentity | null;
  lineQuota?: LineQuotaPublic | null;
}): LineFormalDecision {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  if (!input.connectionPilotEnabled) {
    return refuse("pilot_disabled", "LINE 串接尚未啟用");
  }
  if (!isLineBroadcastFormalEnvironmentOpen(env)) {
    return refuse("send_closed", "正式群發只允許已授權的 Preview 或 Production 環境");
  }
  const organizationId = (input.organizationId ?? "").trim();
  if (organizationId === LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID) {
    return refuse("send_closed", "Beauty OS TEST 只能使用一次性測試路徑，不能走正式群發");
  }
  if (input.actor && !canManageLineOfficialAccount(input.actor)) {
    return refuse("unauthorized", "只有店長可以發送 LINE 群發");
  }
  if (input.actor && input.actor.organizationId !== organizationId) {
    return refuse("unauthorized", "不能發送其他店家的訊息");
  }
  if (!isLineBroadcastFormalOpen({ organizationId, env })) {
    return refuse("send_closed", "正式群發尚未對此店家開放");
  }
  if (input.formalRuntimeOpen !== true) {
    return refuse("send_closed", "正式群發執行開關已關閉");
  }
  if (!input.ownerBroadcastEnabled) {
    return refuse("send_closed", "店長尚未啟用 LINE 群發");
  }
  if (!input.accountConnected || !input.account) {
    return refuse("not_configured", "請先完成 LINE 官方帳號連線測試");
  }
  const shared = evaluateLineBroadcastSharedChannel({
    organizationId,
    channelId: input.account.channelId,
    peers: input.peers,
    peerUsageKnown: input.peerUsageKnown,
    peerAcceptedToday: input.peerAcceptedToday,
    acceptedToday: input.acceptedToday,
  });
  if (!shared.ok) return shared;
  if (input.lineQuota !== undefined && lineQuotaBlocksSend(input.lineQuota)) {
    return refuse("quota_exceeded", lineOfficialQuotaBlockMessage(input.lineQuota));
  }
  if (input.requireIdentity) {
    return evaluateLineBroadcastFormalIdentity({
      account: input.account,
      identity: input.identity,
    });
  }
  return { ok: true };
}

export function lineBroadcastFormalDoesNotUseOneshotPermit(): true {
  return true;
}
