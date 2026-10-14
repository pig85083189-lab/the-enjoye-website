/**
 * Preview-only one-shot Broadcast permit decisions.
 * Does not send. Does not flip LINE_BROADCAST_SEND_OPEN.
 */

import { createHash } from "node:crypto";
import {
  LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID,
  LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
  LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
  LINE_BROADCAST_ONESHOT_CHANNEL_ID,
  LINE_BROADCAST_ONESHOT_TEXT,
  LINE_BROADCAST_ONESHOT_TEXT_SHA256,
  isLineBroadcastOneshotEnvironmentOpen,
} from "@/lib/line/line-flag";
import type { LineDecisionReason } from "@/lib/line/line-types";

export type LineOneshotIdentity = {
  clientId?: string | null;
  displayName?: string | null;
  basicId?: string | null;
};

export type LineBroadcastOneshotDecision =
  | { ok: true }
  | { ok: false; reason: LineDecisionReason; message: string };

function refuse(
  reason: LineDecisionReason,
  message: string,
): Extract<LineBroadcastOneshotDecision, { ok: false }> {
  return { ok: false, reason, message };
}

export function lineBroadcastOneshotMessageSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isLineBroadcastOneshotText(text?: string | null): boolean {
  return (text ?? "") === LINE_BROADCAST_ONESHOT_TEXT;
}

export function evaluateLineBroadcastOneshotPermit(input: {
  env?: NodeJS.Dict<string>;
  connectionPilotEnabled: boolean;
  organizationId?: string | null;
  channelId?: string | null;
  botDisplayName?: string | null;
  botBasicId?: string | null;
  textBody?: string | null;
  runtimeOpen: boolean;
  permitAvailable: boolean;
  requireText?: boolean;
  requireIdentity?: boolean;
  identity?: LineOneshotIdentity | null;
}): LineBroadcastOneshotDecision {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  if (!input.connectionPilotEnabled) {
    return refuse("pilot_disabled", "LINE 串接尚未啟用");
  }
  if (!isLineBroadcastOneshotEnvironmentOpen(env)) {
    return refuse("send_closed", "一次性群發測試只允許 Vercel Preview 與 Preview Supabase");
  }
  if ((input.organizationId ?? "").trim() !== LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID) {
    return refuse("send_closed", "一次性群發測試只允許 Beauty OS TEST");
  }
  if ((input.channelId ?? "").trim() !== LINE_BROADCAST_ONESHOT_CHANNEL_ID) {
    return refuse("send_closed", "Channel ID 與授權測試帳號不一致");
  }
  if ((input.botDisplayName ?? "").trim() !== LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME) {
    return refuse("send_closed", "官方帳號名稱與授權測試帳號不一致");
  }
  if ((input.botBasicId ?? "").trim() !== LINE_BROADCAST_ONESHOT_BOT_BASIC_ID) {
    return refuse("send_closed", "Basic ID 與授權測試帳號不一致");
  }
  if (input.runtimeOpen !== true) {
    return refuse("send_closed", "一次性群發測試總開關已關閉");
  }
  if (input.permitAvailable !== true) {
    return refuse("send_closed", "沒有可用的一次性群發許可");
  }
  if (input.requireText !== false) {
    const text = input.textBody ?? "";
    if (!isLineBroadcastOneshotText(text)) {
      return refuse("invalid_input", "訊息必須與指定測試全文完全一致");
    }
    if (lineBroadcastOneshotMessageSha256(text) !== LINE_BROADCAST_ONESHOT_TEXT_SHA256) {
      return refuse("invalid_input", "訊息必須與指定測試全文完全一致");
    }
  }
  if (input.requireIdentity) {
    const identity = input.identity;
    if (
      !identity ||
      (identity.clientId ?? "").trim() !== LINE_BROADCAST_ONESHOT_CHANNEL_ID ||
      (identity.displayName ?? "").trim() !== LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME ||
      (identity.basicId ?? "").trim() !== LINE_BROADCAST_ONESHOT_BOT_BASIC_ID
    ) {
      return refuse("not_configured", "LINE 官方帳號即時身分與授權測試帳號不一致");
    }
  }
  return { ok: true };
}

export type LineBroadcastOneshotClaimState = {
  runtimeOpen: boolean;
  permitAvailable: boolean;
  permitConsumed: boolean;
  consumedToday: number;
  rows: Record<string, string>;
};

export function applyLineBroadcastOneshotClaimStep(
  state: LineBroadcastOneshotClaimState,
  input: {
    organizationId: string;
    channelId: string;
    botDisplayName: string;
    botBasicId: string;
    textBody: string;
    requestId: string;
    dailyLimit?: number;
    env?: NodeJS.Dict<string>;
  },
): {
  claimed: boolean;
  reason?: LineDecisionReason;
  permitConsumed: boolean;
  consumedToday: number;
} {
  const gate = evaluateLineBroadcastOneshotPermit({
    env: input.env,
    connectionPilotEnabled: true,
    organizationId: input.organizationId,
    channelId: input.channelId,
    botDisplayName: input.botDisplayName,
    botBasicId: input.botBasicId,
    textBody: input.textBody,
    runtimeOpen: state.runtimeOpen,
    permitAvailable: state.permitAvailable && !state.permitConsumed,
    requireText: true,
    requireIdentity: false,
  });
  if (!gate.ok) {
    return {
      claimed: false,
      reason: gate.reason,
      permitConsumed: state.permitConsumed,
      consumedToday: state.consumedToday,
    };
  }
  const status = state.rows[input.requestId] ?? "draft";
  if (status === "accepted" || status === "failed") {
    return {
      claimed: false,
      reason: "duplicate",
      permitConsumed: state.permitConsumed,
      consumedToday: state.consumedToday,
    };
  }
  if (status === "pending_confirmation" || status === "sending") {
    return {
      claimed: false,
      reason: "pending_confirmation",
      permitConsumed: state.permitConsumed,
      consumedToday: state.consumedToday,
    };
  }
  const limit = input.dailyLimit ?? 3;
  if (state.consumedToday >= limit) {
    return {
      claimed: false,
      reason: "quota_exceeded",
      permitConsumed: state.permitConsumed,
      consumedToday: state.consumedToday,
    };
  }
  if (!state.permitAvailable || state.permitConsumed) {
    return {
      claimed: false,
      reason: "send_closed",
      permitConsumed: state.permitConsumed,
      consumedToday: state.consumedToday,
    };
  }
  state.permitConsumed = true;
  state.permitAvailable = false;
  state.consumedToday += 1;
  state.rows[input.requestId] = "sending";
  return {
    claimed: true,
    permitConsumed: true,
    consumedToday: state.consumedToday,
  };
}
