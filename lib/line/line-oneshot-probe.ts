/**
 * Preview TEST Owner-only LINE read-only probe.
 * Never writes. Never sends. Never returns tokens or User IDs.
 */

import {
  LINE_API_ORIGIN,
  LINE_BOT_INFO_PATH,
  LINE_OAUTH_VERIFY_PATH,
  LINE_QUOTA_CONSUMPTION_PATH,
  LINE_QUOTA_PATH,
  type LineActor,
} from "@/lib/line/line-command";
import {
  fetchLineBotInfo,
  fetchLineChannelTokenIdentity,
} from "@/lib/line/line-connection-adapter";
import {
  LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID,
  LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
  LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
  LINE_BROADCAST_ONESHOT_CHANNEL_ID,
  LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST,
} from "@/lib/line/line-flag";
import { canManageLineOfficialAccount } from "@/lib/line/line-roles";
import { fetchLineMessageQuota } from "@/lib/line/line-quota-adapter";
import { describeLineQuota, unknownLineQuota } from "@/lib/line/line-quota";
import {
  LINE_ONESHOT_PROBE_FRIEND_COUNT_LABEL,
} from "@/lib/line/line-visibility";
import type {
  LineDecisionReason,
  LineOneshotReadOnlyProbePublic,
  LineQuotaPublic,
} from "@/lib/line/line-types";

export const LINE_ONESHOT_PROBE_TIMEOUT_MS = 8000;
export {
  LINE_ONESHOT_PROBE_FRIEND_COUNT_LABEL,
  LINE_ONESHOT_PROBE_UNCONFIRMED_LABEL,
  lineOneshotProbeQuotaLimitLabel,
  lineOneshotProbeQuotaRemainingLabel,
  lineOneshotProbeQuotaUsageLabel,
  lineOneshotProbeText,
} from "@/lib/line/line-visibility";
export type { LineOneshotReadOnlyProbePublic } from "@/lib/line/line-types";

export type LineOneshotReadOnlyProbeDecision =
  | { ok: true }
  | { ok: false; reason: LineDecisionReason; message: string };

export type LineOneshotReadOnlyProbeResult =
  | { ok: true; message: string; data: LineOneshotReadOnlyProbePublic }
  | {
      ok: false;
      reason: LineDecisionReason;
      message: string;
      data?: LineOneshotReadOnlyProbePublic;
    };

function refuse(
  reason: LineDecisionReason,
  message: string,
): Extract<LineOneshotReadOnlyProbeDecision, { ok: false }> {
  return { ok: false, reason, message };
}

function previewSupabaseHost(env: NodeJS.Dict<string>): string | null {
  const raw = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

export function evaluateLineOneshotReadOnlyProbe(input: {
  env?: NodeJS.Dict<string>;
  actor: LineActor;
  organizationId?: string | null;
}): LineOneshotReadOnlyProbeDecision {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const organizationId = (input.organizationId ?? "").trim();

  if (!input.actor.authUserId) {
    return refuse("unauthorized", "請先登入後再檢查 LINE");
  }
  if (!canManageLineOfficialAccount(input.actor)) {
    return refuse("unauthorized", "只有店長可以檢查 LINE 連線與額度");
  }
  if (organizationId !== LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID) {
    return refuse("send_closed", "LINE 唯讀診斷只允許 Beauty OS TEST");
  }
  if ((input.actor.organizationId ?? "").trim() !== organizationId) {
    return refuse("unauthorized", "不能管理其他店家的 LINE");
  }
  if ((env.VERCEL_ENV ?? "").trim() !== "preview") {
    return refuse("send_closed", "LINE 唯讀診斷只允許 Vercel Preview");
  }
  if (previewSupabaseHost(env) !== LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST) {
    return refuse("send_closed", "LINE 唯讀診斷只允許 Preview Supabase");
  }
  return { ok: true };
}

export function withLineReadOnlyTimeout(
  fetchImpl: typeof fetch,
  timeoutMs = LINE_ONESHOT_PROBE_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

export function isLineReadOnlyAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    /timeout|aborted/i.test(error instanceof Error ? error.message : "")
  );
}

export function sanitizeLineOneshotProbeQuota(quota: LineQuotaPublic): LineQuotaPublic {
  if (quota.type === "none") {
    return describeLineQuota({ type: "none", usage: quota.usage });
  }
  if (quota.type === "limited") {
    return describeLineQuota({
      type: "limited",
      limit: quota.limit,
      usage: quota.usage,
    });
  }
  return unknownLineQuota("無法確認");
}

function probeSnapshot(input: {
  connected: boolean;
  tokenValid: boolean;
  displayName?: string | null;
  basicId?: string | null;
  channelId?: string | null;
  quota: LineQuotaPublic;
  checkedAt: string;
}): LineOneshotReadOnlyProbePublic {
  return {
    connected: input.connected,
    tokenValid: input.tokenValid,
    displayName: (input.displayName ?? "").trim() || null,
    basicId: (input.basicId ?? "").trim() || null,
    channelId: (input.channelId ?? "").trim() || null,
    quota: sanitizeLineOneshotProbeQuota(input.quota),
    friendCountLabel: LINE_ONESHOT_PROBE_FRIEND_COUNT_LABEL,
    checkedAt: input.checkedAt,
  };
}

export function interpretLineOneshotReadOnlyProbe(input: {
  identity: {
    clientId?: string | null;
    displayName?: string | null;
    basicId?: string | null;
  };
  quota: LineQuotaPublic;
  checkedAt: string;
}): LineOneshotReadOnlyProbeResult {
  const clientId = (input.identity.clientId ?? "").trim();
  const displayName = (input.identity.displayName ?? "").trim();
  const basicId = (input.identity.basicId ?? "").trim();
  const tokenValid = Boolean(clientId);
  const data = probeSnapshot({
    connected: false,
    tokenValid,
    displayName,
    basicId,
    channelId: clientId,
    quota: input.quota,
    checkedAt: input.checkedAt,
  });

  const mismatched =
    (clientId !== "" && clientId !== LINE_BROADCAST_ONESHOT_CHANNEL_ID) ||
    (displayName !== "" && displayName !== LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME) ||
    (basicId !== "" && basicId !== LINE_BROADCAST_ONESHOT_BOT_BASIC_ID);
  if (mismatched) {
    return {
      ok: false,
      reason: "not_configured",
      message: "LINE 官方帳號即時身分與授權測試帳號不一致",
      data,
    };
  }
  if (!clientId || !displayName || !basicId) {
    return {
      ok: false,
      reason: "not_configured",
      message: "LINE API 回傳資料不足，無法確認官方帳號身分",
      data,
    };
  }
  return {
    ok: true,
    message: "LINE 連線成功。這次檢查沒有發送訊息，也沒有寫入資料。",
    data: {
      ...data,
      connected: true,
      tokenValid: true,
    },
  };
}

export async function runLineOneshotReadOnlyProbe(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  writes?: { count: number };
}): Promise<LineOneshotReadOnlyProbeResult> {
  const writes = input.writes ?? { count: 0 };
  if (writes.count !== 0) {
    return { ok: false, reason: "error", message: "診斷過程不得寫入資料" };
  }
  const fetchImpl = withLineReadOnlyTimeout(input.fetchImpl ?? fetch);
  const checkedAt = (input.now ?? (() => new Date()))().toISOString();
  try {
    const [bot, token] = await Promise.all([
      fetchLineBotInfo(input.accessToken, fetchImpl),
      fetchLineChannelTokenIdentity(input.accessToken, fetchImpl),
    ]);
    if (!bot.ok || !token.ok) {
      return {
        ok: false,
        reason: "not_configured",
        message: !token.ok ? token.message : !bot.ok ? bot.message : "無法確認 LINE 連線",
        data: probeSnapshot({
          connected: false,
          tokenValid: token.ok && Boolean(token.clientId),
          displayName: bot.ok ? bot.displayName : null,
          basicId: bot.ok ? bot.basicId : null,
          channelId: token.ok ? token.clientId : null,
          quota: unknownLineQuota("無法確認"),
          checkedAt,
        }),
      };
    }
    const quota = await fetchLineMessageQuota({
      accessToken: input.accessToken,
      fetchImpl,
    });
    if (writes.count !== 0) {
      return { ok: false, reason: "error", message: "診斷過程不得寫入資料" };
    }
    return interpretLineOneshotReadOnlyProbe({
      identity: {
        clientId: token.clientId,
        displayName: bot.displayName,
        basicId: bot.basicId,
      },
      quota,
      checkedAt,
    });
  } catch (error) {
    if (isLineReadOnlyAbortError(error)) {
      return {
        ok: false,
        reason: "error",
        message: "LINE 連線逾時，未變更任何資料",
      };
    }
    return { ok: false, reason: "error", message: "目前無法連線到 LINE API" };
  }
}

export const LINE_ONESHOT_PROBE_ALLOWED_PATHS = [
  `${LINE_API_ORIGIN}${LINE_OAUTH_VERIFY_PATH}`,
  `${LINE_API_ORIGIN}${LINE_BOT_INFO_PATH}`,
  `${LINE_API_ORIGIN}${LINE_QUOTA_PATH}`,
  `${LINE_API_ORIGIN}${LINE_QUOTA_CONSUMPTION_PATH}`,
] as const;
