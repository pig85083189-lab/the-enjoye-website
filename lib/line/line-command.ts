/**
 * Pure LINE connection / broadcast decisions.
 * Server actions must call these before any LINE HTTP or RPC side effect.
 */

import {
  LINE_BROADCAST_DAILY_LIMIT,
  LINE_BROADCAST_TEXT_MAX,
} from "@/lib/line/line-flag";
import { canManageLineOfficialAccount } from "@/lib/line/line-roles";
import type {
  LineApiResult,
  LineBroadcastPublic,
  LineBroadcastStatus,
  LineDecisionReason,
} from "@/lib/line/line-types";
import type { StaffRole } from "@/types/saas";

export const UPSERT_LINE_CONNECTION_RPC = "upsert_line_official_account_connection";
export const SET_LINE_BROADCAST_ENABLED_RPC = "set_line_broadcast_enabled";
export const RECORD_LINE_CONNECTION_TEST_RPC = "record_line_connection_test";
export const UPSERT_LINE_BROADCAST_DRAFT_RPC = "upsert_line_broadcast_draft";
export const MARK_LINE_BROADCAST_SEND_CLOSED_RPC = "mark_line_broadcast_send_closed";
export const READ_LINE_SECRETS_RPC = "read_line_official_account_secrets";

export const LINE_BOT_INFO_PATH = "/v2/bot/info";
export const LINE_BROADCAST_PATH = "/v2/bot/message/broadcast";
export const LINE_API_ORIGIN = "https://api.line.me";

export type LineActor = {
  authUserId: string | null;
  role: StaffRole | null;
  isActive: boolean;
  organizationId: string | null;
  userId: string | null;
};

export type LineDecision =
  | { ok: true }
  | { ok: false; reason: LineDecisionReason; message: string };

function refuse(
  reason: LineDecisionReason,
  message: string,
): Extract<LineDecision, { ok: false }> {
  return { ok: false, reason, message };
}

function requireOwner(actor: LineActor, organizationId?: string | null): LineDecision {
  if (!organizationId || !organizationId.startsWith("org-")) {
    return refuse("unauthorized", "缺少店家識別");
  }
  if (!actor.authUserId) {
    return refuse("unauthorized", "請先登入後再管理 LINE");
  }
  if (actor.organizationId !== organizationId) {
    return refuse("unauthorized", "不能管理其他店家的 LINE");
  }
  if (!canManageLineOfficialAccount(actor)) {
    return refuse("unauthorized", "只有店長可以管理 LINE 官方帳號");
  }
  if (!actor.userId || actor.userId.startsWith("00000000")) {
    return refuse("unauthorized", "員工識別不合法");
  }
  return { ok: true };
}

export function evaluateLineConnectionSave(input: {
  connectionPilotEnabled: boolean;
  encryptionReady: boolean;
  organizationId?: string | null;
  actor: LineActor;
  channelId?: string | null;
  channelSecret?: string | null;
  channelAccessToken?: string | null;
}): LineDecision {
  if (!input.connectionPilotEnabled) {
    return refuse("pilot_disabled", "LINE 串接尚未啟用");
  }
  const owner = requireOwner(input.actor, input.organizationId);
  if (!owner.ok) return owner;
  if (!input.encryptionReady) {
    return refuse("not_configured", "LINE 憑證加密金鑰尚未設定");
  }
  const channelId = input.channelId?.trim() ?? "";
  const secret = input.channelSecret?.trim() ?? "";
  const token = input.channelAccessToken?.trim() ?? "";
  if (!channelId || !/^\d{5,}$/.test(channelId)) {
    return refuse("invalid_input", "請輸入有效的 Channel ID");
  }
  if (secret.length < 8) {
    return refuse("invalid_input", "請輸入 Channel Secret");
  }
  if (token.length < 16) {
    return refuse("invalid_input", "請輸入 Channel Access Token");
  }
  return { ok: true };
}

export function evaluateLineConnectionTest(input: {
  connectionPilotEnabled: boolean;
  encryptionReady: boolean;
  organizationId?: string | null;
  actor: LineActor;
  secretConfigured: boolean;
  tokenConfigured: boolean;
}): LineDecision {
  if (!input.connectionPilotEnabled) {
    return refuse("pilot_disabled", "LINE 串接尚未啟用");
  }
  const owner = requireOwner(input.actor, input.organizationId);
  if (!owner.ok) return owner;
  if (!input.encryptionReady || !input.secretConfigured || !input.tokenConfigured) {
    return refuse("not_configured", "請先保存 LINE 官方帳號憑證");
  }
  return { ok: true };
}

export function evaluateLineBroadcastEnable(input: {
  connectionPilotEnabled: boolean;
  organizationId?: string | null;
  actor: LineActor;
  enabled: boolean;
  tokenConfigured: boolean;
}): LineDecision {
  if (!input.connectionPilotEnabled) {
    return refuse("pilot_disabled", "LINE 串接尚未啟用");
  }
  const owner = requireOwner(input.actor, input.organizationId);
  if (!owner.ok) return owner;
  if (input.enabled && !input.tokenConfigured) {
    return refuse("not_configured", "請先完成 LINE 連線測試再啟用群發");
  }
  return { ok: true };
}

export function evaluateLineBroadcastDraft(input: {
  connectionPilotEnabled: boolean;
  organizationId?: string | null;
  actor: LineActor;
  textBody?: string | null;
}): LineDecision {
  if (!input.connectionPilotEnabled) {
    return refuse("pilot_disabled", "LINE 串接尚未啟用");
  }
  const owner = requireOwner(input.actor, input.organizationId);
  if (!owner.ok) return owner;
  const text = input.textBody ?? "";
  if (!text.trim()) {
    return refuse("invalid_input", "請輸入要群發的文字");
  }
  if (text.length > LINE_BROADCAST_TEXT_MAX) {
    return refuse("invalid_input", `文字最多 ${LINE_BROADCAST_TEXT_MAX} 字`);
  }
  return { ok: true };
}

export function evaluateLineBroadcastSend(input: {
  connectionPilotEnabled: boolean;
  sendOpen: boolean;
  ownerBroadcastEnabled: boolean;
  organizationId?: string | null;
  actor: LineActor;
  textBody?: string | null;
  existing?: LineBroadcastPublic | null;
  requestId?: string | null;
  acceptedToday: number;
  dailyLimit?: number;
}):
  | { ok: true; requestId: string }
  | { ok: false; reason: LineDecisionReason; message: string } {
  const draft = evaluateLineBroadcastDraft({
    connectionPilotEnabled: input.connectionPilotEnabled,
    organizationId: input.organizationId,
    actor: input.actor,
    textBody: input.textBody,
  });
  if (!draft.ok) return draft;
  if (input.existing && input.existing.organizationId !== input.organizationId) {
    return refuse("unauthorized", "不能發送其他店家的訊息");
  }
  if (input.existing?.status === "pending_confirmation") {
    return refuse(
      "pending_confirmation",
      "上一則發送結果待確認，系統不會自動重送",
    );
  }
  if (input.existing?.status === "accepted") {
    return refuse("duplicate", "這則訊息已經被 LINE API 接受，不會重送");
  }
  if (input.existing?.status === "sending") {
    return refuse("pending_confirmation", "發送進行中，請勿重複送出");
  }
  const requestId = input.requestId?.trim() || input.existing?.requestId || "";
  if (!requestId.startsWith("lbrq-")) {
    return refuse("invalid_input", "缺少可追蹤的發送識別");
  }
  const limit = input.dailyLimit ?? LINE_BROADCAST_DAILY_LIMIT;
  if (input.acceptedToday >= limit) {
    return refuse("quota_exceeded", "今日群發次數已達上限");
  }
  if (!input.ownerBroadcastEnabled) {
    return refuse("send_closed", "店長尚未啟用 LINE 群發");
  }
  if (!input.sendOpen) {
    return refuse("send_closed", "LINE 群發尚未開放實際發送");
  }
  return { ok: true, requestId };
}

export function interpretLineBroadcastApiOutcome(input: {
  timedOut: boolean;
  httpOk: boolean;
  lineRequestId?: string | null;
}): { apiResult: LineApiResult; status: LineBroadcastStatus; message: string } {
  if (input.timedOut) {
    return {
      apiResult: "pending_confirmation",
      status: "pending_confirmation",
      message: "LINE API 逾時，系統已標記待確認，不會自動重送",
    };
  }
  if (input.httpOk) {
    return {
      apiResult: "accepted",
      status: "accepted",
      message: "LINE API 已接受這則廣播，不代表每位好友都已收到",
    };
  }
  return {
    apiResult: "failed",
    status: "failed",
    message: "LINE API 拒絕這則廣播",
  };
}

export function newLineRequestId(random: () => string = () => crypto.randomUUID()): string {
  return `lbrq-${random().replace(/-/g, "").slice(0, 16)}`;
}

export function newLineBroadcastId(random: () => string = () => crypto.randomUUID()): string {
  return `lbr-${random().replace(/-/g, "").slice(0, 16)}`;
}

export function newLineEventId(random: () => string = () => crypto.randomUUID()): string {
  return `lbe-${random().replace(/-/g, "").slice(0, 16)}`;
}
