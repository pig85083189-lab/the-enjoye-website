/**
 * Pure LINE connection / broadcast decisions.
 * Server actions must call these before any LINE HTTP or RPC side effect.
 */

import {
  LINE_BROADCAST_DAILY_LIMIT,
  LINE_BROADCAST_TEXT_MAX,
  LINE_TEST_PUSH_ALLOWED_ORG_ID,
  LINE_TEST_PUSH_DAILY_LIMIT,
} from "@/lib/line/line-flag";
import { canManageLineOfficialAccount } from "@/lib/line/line-roles";
import { lineQuotaBlocksSend } from "@/lib/line/line-quota";
import type {
  LineApiResult,
  LineBroadcastPublic,
  LineBroadcastStatus,
  LineDecisionReason,
  LineOwnerRecipientPublic,
  LineQuotaPublic,
  LineTestSendPublic,
} from "@/lib/line/line-types";
import type { StaffRole } from "@/types/saas";

export const UPSERT_LINE_CONNECTION_RPC = "upsert_line_official_account_connection";
export const SET_LINE_BROADCAST_ENABLED_RPC = "set_line_broadcast_enabled";
export const RECORD_LINE_CONNECTION_TEST_RPC = "record_line_connection_test";
export const UPSERT_LINE_BROADCAST_DRAFT_RPC = "upsert_line_broadcast_draft";
export const MARK_LINE_BROADCAST_SEND_CLOSED_RPC = "mark_line_broadcast_send_closed";
export const CLAIM_LINE_BROADCAST_SEND_RPC = "claim_line_broadcast_send";
export const COMPLETE_LINE_BROADCAST_SEND_RPC = "complete_line_broadcast_send";
export const RECORD_LINE_BROADCAST_OWNER_EVENT_RPC = "record_line_broadcast_owner_event";
export const READ_LINE_SECRETS_RPC = "read_line_official_account_secrets";
export const OWNER_READ_LINE_TOKEN_CIPHER_RPC = "owner_read_line_access_token_cipher";
export const READ_LINE_CHANNEL_SECRET_CIPHER_RPC = "read_line_channel_secret_cipher";
export const READ_LINE_WEBHOOK_CHANNEL_SECRET_CIPHER_RPC =
  "read_line_webhook_channel_secret_cipher";
export const UPSERT_LINE_WEBHOOK_PUBLIC_TOKEN_RPC = "upsert_line_webhook_public_token";
export const OWNER_READ_LINE_WEBHOOK_TOKEN_CIPHER_RPC = "owner_read_line_webhook_token_cipher";
export const CLAIM_LINE_WEBHOOK_EVENT_RPC = "claim_line_webhook_event";
export const START_LINE_OWNER_BIND_RPC = "start_line_owner_bind_challenge";
export const CONSUME_LINE_OWNER_BIND_RPC = "consume_line_owner_bind_challenge";
export const CONSUME_LINE_OWNER_BIND_PUBLIC_RPC = "consume_line_owner_bind_challenge_public";
export const UNBIND_LINE_OWNER_RECIPIENT_RPC = "unbind_line_owner_recipient";
export const OWNER_READ_LINE_RECIPIENT_CIPHER_RPC = "owner_read_line_recipient_user_id_cipher";
export const SET_LINE_TEST_PUSH_ENABLED_RPC = "set_line_test_push_enabled";
export const SET_LINE_TEST_PUSH_RUNTIME_OPEN_RPC = "set_line_test_push_runtime_open";
export const UPSERT_LINE_TEST_SEND_DRAFT_RPC = "upsert_line_test_send_draft";
export const CLAIM_LINE_TEST_SEND_RPC = "claim_line_test_send";
export const COMPLETE_LINE_TEST_SEND_RPC = "complete_line_test_send";

export const LINE_TEST_PUSH_REUSABLE_STATUSES = [
  "draft",
  "confirm_pending",
  "queued",
] as const;

export const LINE_TEST_PUSH_CONSUMED_STATUSES = [
  "failed",
  "accepted",
  "pending_confirmation",
  "sending",
  "send_closed",
  "canceled",
] as const;

export const LINE_BOT_INFO_PATH = "/v2/bot/info";
export const LINE_BROADCAST_PATH = "/v2/bot/message/broadcast";
export const LINE_PUSH_PATH = "/v2/bot/message/push";
export const LINE_QUOTA_PATH = "/v2/bot/message/quota";
export const LINE_QUOTA_CONSUMPTION_PATH = "/v2/bot/message/quota/consumption";
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

export function resolveVerifiedLineOrganizationId(input: {
  requestedOrganizationId?: string | null;
  actor: LineActor;
}): { ok: true; organizationId: string } | { ok: false; reason: LineDecisionReason; message: string } {
  const requested = input.requestedOrganizationId?.trim() ?? "";
  const owner = requireOwner(input.actor, requested);
  if (!owner.ok) return owner;
  const organizationId = input.actor.organizationId?.trim() ?? "";
  if (!organizationId || organizationId !== requested) {
    return refuse("unauthorized", "不能管理其他店家的 LINE");
  }
  return { ok: true, organizationId };
}

export function evaluateLineTestPushClaimQuota(input: {
  consumedToday: number;
  dailyLimit?: number;
}): LineDecision {
  const limit = input.dailyLimit ?? LINE_TEST_PUSH_DAILY_LIMIT;
  if (input.consumedToday >= limit) {
    return refuse("quota_exceeded", "今日測試發送次數已達上限");
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
  accountConnected?: boolean;
  lineQuota?: LineQuotaPublic | null;
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
  if (input.sendOpen && input.accountConnected === false) {
    return refuse("not_configured", "請先完成 LINE 官方帳號連線測試");
  }
  if (input.sendOpen && lineQuotaBlocksSend(input.lineQuota)) {
    return refuse("quota_exceeded", "LINE 訊息額度不足");
  }
  if (!input.ownerBroadcastEnabled) {
    return refuse("send_closed", "店長尚未啟用 LINE 群發");
  }
  if (!input.sendOpen) {
    return refuse("send_closed", "LINE 群發尚未開放實際發送");
  }
  return { ok: true, requestId };
}

export function evaluateLineBroadcastRealSend(input: {
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
  accountConnected: boolean;
  acknowledged: boolean;
  lineQuota?: LineQuotaPublic | null;
}):
  | { ok: true; requestId: string }
  | { ok: false; reason: LineDecisionReason; message: string } {
  if (!input.acknowledged) {
    return refuse("invalid_input", "請先勾選真實發送確認");
  }
  if (!input.accountConnected) {
    return refuse("not_configured", "請先完成 LINE 官方帳號連線測試");
  }
  return evaluateLineBroadcastSend(input);
}

export function interpretLineBroadcastApiOutcome(input: {
  timedOut: boolean;
  httpOk: boolean;
  lineRequestId?: string | null;
}): {
  apiResult: LineApiResult;
  status: LineBroadcastStatus;
  message: string;
  errorClass: null;
} {
  if (input.timedOut) {
    return {
      apiResult: "pending_confirmation",
      status: "pending_confirmation",
      message: "LINE API 逾時，系統已標記待確認，不會自動重送",
      errorClass: null,
    };
  }
  if (input.httpOk) {
    return {
      apiResult: "accepted",
      status: "accepted",
      message: "LINE API 已接受。不代表每位好友都已收到。",
      errorClass: null,
    };
  }
  return {
    apiResult: "failed",
    status: "failed",
    message: "LINE API 拒絕這則廣播",
    errorClass: null,
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

export function newLineTestRequestId(random: () => string = () => crypto.randomUUID()): string {
  return `ltsq-${random().replace(/-/g, "").slice(0, 16)}`;
}

export function evaluateLineOwnerBindStart(input: {
  connectionPilotEnabled: boolean;
  organizationId?: string | null;
  actor: LineActor;
  secretConfigured: boolean;
}): LineDecision {
  if (!input.connectionPilotEnabled) {
    return refuse("pilot_disabled", "LINE 串接尚未啟用");
  }
  const owner = requireOwner(input.actor, input.organizationId);
  if (!owner.ok) return owner;
  if (!input.secretConfigured) {
    return refuse("not_configured", "請先保存 LINE 官方帳號憑證");
  }
  return { ok: true };
}

export function resolveLineTestPushRuntimeState(input: {
  readOk: boolean;
  organizationId?: string | null;
  runtimeOpen?: boolean | null;
}): { readOk: boolean; open: boolean } {
  if (!input.readOk) {
    return { readOk: false, open: false };
  }
  const organizationId = (input.organizationId ?? "").trim();
  if (organizationId !== LINE_TEST_PUSH_ALLOWED_ORG_ID) {
    return { readOk: true, open: false };
  }
  return { readOk: true, open: input.runtimeOpen === true };
}

export function evaluateLineTestPushRuntimeSwitch(input: {
  connectionPilotEnabled: boolean;
  organizationId?: string | null;
  actor: LineActor;
  open: boolean;
  vercelEnv?: string | null;
}): LineDecision {
  if (!input.connectionPilotEnabled) {
    return refuse("pilot_disabled", "LINE 串接尚未啟用");
  }
  const owner = requireOwner(input.actor, input.organizationId);
  if (!owner.ok) return owner;
  if ((input.vercelEnv ?? "").trim() === "production") {
    return refuse("send_closed", "Production 永遠禁止測試 Push");
  }
  if (input.open && input.organizationId !== LINE_TEST_PUSH_ALLOWED_ORG_ID) {
    return refuse("send_closed", "測試發送總開關只能在 Beauty OS TEST 開啟");
  }
  return { ok: true };
}

export function evaluateLineTestPushRequestReuse(input: {
  existing?: LineTestSendPublic | null;
  requestId?: string | null;
}):
  | { ok: true; requestId: string }
  | { ok: false; reason: LineDecisionReason; message: string } {
  const requestId = input.requestId?.trim() || input.existing?.requestId || "";
  if (!requestId.startsWith("ltsq-")) {
    return refuse("invalid_input", "缺少可追蹤的測試發送識別");
  }
  const existing = input.existing;
  if (!existing) {
    return { ok: true, requestId };
  }
  if (existing.requestId && existing.requestId !== requestId) {
    return refuse("invalid_input", "發送識別不一致");
  }
  if (existing.status === "accepted") {
    return refuse("duplicate", "這則測試已經被 LINE API 接受，不會重送");
  }
  if (existing.status === "pending_confirmation" || existing.status === "sending") {
    return refuse("pending_confirmation", "上一則測試結果待確認，系統不會自動重送");
  }
  if (
    existing.status === "failed" ||
    existing.status === "send_closed" ||
    existing.status === "canceled" ||
    (LINE_TEST_PUSH_CONSUMED_STATUSES as readonly string[]).includes(existing.status)
  ) {
    return refuse("duplicate", "這則測試識別已使用過，不會重送。請用新的 requestId");
  }
  if ((LINE_TEST_PUSH_REUSABLE_STATUSES as readonly string[]).includes(existing.status)) {
    return { ok: true, requestId };
  }
  return refuse("send_closed", "這則測試不能再發送");
}

export type LineTestPushRuntimeLockState = {
  runtimeOpen: boolean;
  claimed: boolean;
};

/**
 * Serialized close/claim protocol used by isolation tests.
 * Mirrors claim_line_test_send: both actions take the same org row lock,
 * so a close cannot race past an in-progress claim, and a later claim
 * must see the closed flag. In-flight HTTP after claimed=true cannot
 * be cancelled.
 */
export function applyLineTestPushRuntimeLockStep(
  state: LineTestPushRuntimeLockState,
  action: "close" | "claim",
): { ok: boolean; claimed: boolean; runtimeOpen: boolean } {
  if (action === "close") {
    state.runtimeOpen = false;
    return { ok: true, claimed: state.claimed, runtimeOpen: false };
  }
  if (!state.runtimeOpen) {
    return { ok: false, claimed: false, runtimeOpen: false };
  }
  state.claimed = true;
  return { ok: true, claimed: true, runtimeOpen: true };
}

export function evaluateLineTestPushEnable(input: {
  connectionPilotEnabled: boolean;
  organizationId?: string | null;
  actor: LineActor;
  enabled: boolean;
  recipientBound: boolean;
}): LineDecision {
  if (!input.connectionPilotEnabled) {
    return refuse("pilot_disabled", "LINE 串接尚未啟用");
  }
  const owner = requireOwner(input.actor, input.organizationId);
  if (!owner.ok) return owner;
  if (input.enabled && !input.recipientBound) {
    return refuse("not_configured", "請先完成店長 LINE 綁定");
  }
  return { ok: true };
}

export function evaluateLineTestPushSend(input: {
  connectionPilotEnabled: boolean;
  testPushOpen: boolean;
  ownerTestPushEnabled: boolean;
  organizationId?: string | null;
  actor: LineActor;
  textBody?: string | null;
  existing?: LineTestSendPublic | null;
  requestId?: string | null;
  acceptedToday: number;
  dailyLimit?: number;
  accountConnected: boolean;
  acknowledged: boolean;
  recipient?: LineOwnerRecipientPublic | null;
  runtimeReadOk?: boolean;
  runtimeOpen?: boolean;
}):
  | { ok: true; requestId: string }
  | { ok: false; reason: LineDecisionReason; message: string } {
  if (!input.acknowledged) {
    return refuse("invalid_input", "請先勾選測試發送確認");
  }
  const draft = evaluateLineBroadcastDraft({
    connectionPilotEnabled: input.connectionPilotEnabled,
    organizationId: input.organizationId,
    actor: input.actor,
    textBody: input.textBody,
  });
  if (!draft.ok) return draft;
  if (!input.accountConnected) {
    return refuse("not_configured", "請先完成 LINE 官方帳號連線測試");
  }
  if (!input.recipient?.bound) {
    return refuse("not_configured", "請先完成店長 LINE 綁定");
  }
  if (input.recipient.organizationId !== input.organizationId) {
    return refuse("unauthorized", "不能發送給其他店家的收件者");
  }
  if (input.existing && input.existing.organizationId !== input.organizationId) {
    return refuse("unauthorized", "不能發送其他店家的測試訊息");
  }
  const reuse = evaluateLineTestPushRequestReuse({
    existing: input.existing,
    requestId: input.requestId,
  });
  if (!reuse.ok) return reuse;
  const limit = input.dailyLimit ?? LINE_TEST_PUSH_DAILY_LIMIT;
  if (input.acceptedToday >= limit) {
    return refuse("quota_exceeded", "今日測試發送次數已達上限");
  }
  if (!input.ownerTestPushEnabled) {
    return refuse("send_closed", "店長尚未啟用測試發送");
  }
  if (!input.testPushOpen) {
    return refuse("send_closed", "測試發送尚未開放實際 Push");
  }
  if (input.runtimeReadOk === false) {
    return refuse("send_closed", "無法確認測試發送總開關，已拒絕發送");
  }
  if (input.runtimeOpen !== true) {
    return refuse("send_closed", "測試發送總開關已關閉");
  }
  const runtime = resolveLineTestPushRuntimeState({
    readOk: true,
    organizationId: input.organizationId,
    runtimeOpen: input.runtimeOpen,
  });
  if (!runtime.readOk || !runtime.open) {
    return refuse("send_closed", "測試發送總開關已關閉");
  }
  return { ok: true, requestId: reuse.requestId };
}
