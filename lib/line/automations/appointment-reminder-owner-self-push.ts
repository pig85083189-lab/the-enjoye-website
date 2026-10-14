/**
 * Phase 2E-6 Owner-self reminder test. SEND stays hardcoded closed.
 * Reuses THE ENJOYE Channel 2009219238. Does not retarget the official
 * Webhook URL, does not reuse test-push as authorization, and never
 * designates a LINE userId.
 */

import {
  LINE_APPOINTMENT_REMINDER_SEND_OPEN,
  isAppointmentReminderSendOpen,
} from "@/lib/line/automations/appointment-reminder-flag";
import { reminderChannelSnapshotAllowsSend } from "@/lib/line/automations/appointment-reminder-dispatcher";
import { isLineUnknownHttpOutcome } from "@/lib/line/line-http-error";
import {
  LINE_BROADCAST_ONESHOT_CHANNEL_ID,
  LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST,
  LINE_CREDENTIAL_KEY_ID,
} from "@/lib/line/line-flag";
import type { LineHttpErrorClass, LineQuotaPublic } from "@/lib/line/line-types";
import { ORG_BEAUTY_OS_TEST_ID } from "@/lib/tenant/constants";

export const LINE_APPOINTMENT_REMINDER_OWNER_SELF_PUSH_OPEN = false;
export const OWNER_SELF_REMINDER_ALLOWED_ORG_ID = ORG_BEAUTY_OS_TEST_ID;
export const OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID = LINE_BROADCAST_ONESHOT_CHANNEL_ID;
export const OWNER_SELF_REMINDER_DAILY_LIMIT = 1;
export const OWNER_SELF_REMINDER_CONFIRM_PHRASE = "確認發送一則給我自己的預約提醒測試";
export const OWNER_SELF_REMINDER_ONESHOT_PREFIX = "laros-";
export const OWNER_SELF_REMINDER_KILL_SWITCH_OPEN = false;
export const OWNER_SELF_REMINDER_FAKE_CUSTOMER_ID = "cust-2d2-fake-bound";

export type OwnerSelfReminderReason =
  | "send_closed"
  | "unauthorized"
  | "invalid_input"
  | "unbound"
  | "not_consented"
  | "invalid_recipient"
  | "duplicate"
  | "quota_exceeded"
  | "inflight";

export type OwnerSelfBindEvidence = {
  organizationId: string;
  staffUserId: string;
  hint: string;
  bindMethod: "webhook_code" | string | null;
  keyId: string | null;
  secretPresent: boolean;
  boundAt: string | null;
  testPushEnabled: boolean;
};

export type OwnerSelfReminderView = {
  visible: boolean;
  organizationId: string;
  channelLast4: string;
  ownerBindPresent: boolean;
  ownerBindHint: string;
  ownerBindReusableAsReminder: false;
  independentConsent: false;
  trustworthyRecipient: false;
  remainingToday: number;
  confirmPhrase: string;
  oneshotId: string;
  killSwitchOpen: false;
  sendOpen: false;
  canSubmit: false;
  quotaLabel: string;
};

export type OwnerSelfReminderDecision = {
  authorized: boolean;
  wouldSend: false;
  sent: false;
  reason: OwnerSelfReminderReason;
  message: string;
  audit: {
    organizationId: string;
    staffUserId: string;
    oneshotId: string;
    recipientHint: string;
    authorized: boolean;
    wouldSend: false;
    sent: false;
  };
};

function previewHost(env: NodeJS.Dict<string>): string | null {
  const raw = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function isPreviewControlledEnvironment(env: NodeJS.Dict<string>): boolean {
  if ((env.VERCEL_ENV ?? "").trim() === "production") return false;
  if ((env.VERCEL_ENV ?? "").trim() !== "preview") return false;
  return previewHost(env) === LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST;
}

export function isOwnerSelfReminderPanelVisible(organizationId: string | null | undefined): boolean {
  return organizationId === OWNER_SELF_REMINDER_ALLOWED_ORG_ID;
}

export function newOwnerSelfReminderOneshotId(
  random: () => string = () => crypto.randomUUID(),
): string {
  return `${OWNER_SELF_REMINDER_ONESHOT_PREFIX}${random().replace(/-/g, "").slice(0, 16)}`;
}

export function ownerSelfReminderRefusesRetry(input: {
  oneshotConsumed?: boolean;
  previousStatus?: string | null;
  previousErrorClass?: LineHttpErrorClass | string | null;
  previousHttpStatus?: number | null;
}): boolean {
  if (input.oneshotConsumed) return true;
  if (input.previousStatus === "accepted" || input.previousStatus === "pending_confirmation") {
    return true;
  }
  if (input.previousErrorClass === "timeout" || input.previousErrorClass === "unknown") return true;
  return isLineUnknownHttpOutcome(input.previousHttpStatus);
}

/**
 * Webhook-verified Owner bind is identity evidence only.
 * Test-push enablement, Owner role, nickname, or a fake customer never authorize.
 */
export function evaluateOwnerSelfIdentity(input: {
  organizationId: string;
  actorStaffUserId?: string | null;
  evidence?: OwnerSelfBindEvidence | null;
  independentConsent: boolean;
  testPushRecipientReused?: boolean;
  fakeCustomerId?: string | null;
  plaintextLineUserId?: string | null;
}): { ok: true } | { ok: false; reason: OwnerSelfReminderReason; message: string } {
  if (input.plaintextLineUserId) {
    return { ok: false, reason: "invalid_recipient", message: "不能手動填入 LINE userId" };
  }
  if (input.fakeCustomerId === OWNER_SELF_REMINDER_FAKE_CUSTOMER_ID) {
    return { ok: false, reason: "invalid_recipient", message: "不能使用假綁定客人作為店長本人收件者" };
  }
  if (input.testPushRecipientReused) {
    return {
      ok: false,
      reason: "invalid_recipient",
      message: "既有店長 test-push 設定不能直接當作預約提醒收件者",
    };
  }
  const evidence = input.evidence;
  if (!evidence) {
    return { ok: false, reason: "unbound", message: "尚未有官方 Webhook 驗證的店長 LINE 綁定" };
  }
  if (evidence.organizationId !== input.organizationId) {
    return { ok: false, reason: "unauthorized", message: "不能使用其他店家的店長 LINE 綁定" };
  }
  if (evidence.bindMethod !== "webhook_code") {
    return { ok: false, reason: "unbound", message: "店長 LINE 必須經官方 Webhook 驗證碼綁定" };
  }
  if (!evidence.secretPresent || evidence.keyId !== LINE_CREDENTIAL_KEY_ID) {
    return { ok: false, reason: "unbound", message: "店長 LINE 綁定不是可解密的正式憑證" };
  }
  if (!evidence.hint.startsWith("••••")) {
    return { ok: false, reason: "invalid_recipient", message: "店長 LINE 只能顯示遮罩" };
  }
  if (!input.actorStaffUserId || evidence.staffUserId !== input.actorStaffUserId) {
    return { ok: false, reason: "unauthorized", message: "綁定必須屬於目前登入的店長本人" };
  }
  if (evidence.testPushEnabled) {
    return {
      ok: false,
      reason: "invalid_recipient",
      message: "既有店長 test-push 設定不能直接當作預約提醒收件者",
    };
  }
  if (!input.independentConsent) {
    return {
      ok: false,
      reason: "not_consented",
      message: "尚未另外同意這次預約提醒測試，不能沿用 test-push 或店長角色",
    };
  }
  return { ok: true };
}

export function buildOwnerSelfReminderView(input: {
  organizationId: string;
  evidence?: OwnerSelfBindEvidence | null;
  oneshotId?: string;
  quotaLabel?: string;
}): OwnerSelfReminderView {
  const evidence = input.evidence;
  return {
    visible: isOwnerSelfReminderPanelVisible(input.organizationId),
    organizationId: OWNER_SELF_REMINDER_ALLOWED_ORG_ID,
    channelLast4: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID.slice(-4),
    ownerBindPresent: Boolean(evidence?.bindMethod === "webhook_code" && evidence.hint),
    ownerBindHint: evidence?.hint?.startsWith("••••") ? evidence.hint : "••••",
    ownerBindReusableAsReminder: false,
    independentConsent: false,
    trustworthyRecipient: false,
    remainingToday: OWNER_SELF_REMINDER_DAILY_LIMIT,
    confirmPhrase: OWNER_SELF_REMINDER_CONFIRM_PHRASE,
    oneshotId: input.oneshotId ?? "",
    killSwitchOpen: false,
    sendOpen: false,
    canSubmit: false,
    quotaLabel: input.quotaLabel ?? "本階段不查詢 LINE 額度，不會連接 LINE",
  };
}

function refuse(
  input: { organizationId: string; staffUserId: string; oneshotId: string; recipientHint: string },
  reason: OwnerSelfReminderReason,
  message: string,
): OwnerSelfReminderDecision {
  return {
    authorized: false,
    wouldSend: false,
    sent: false,
    reason,
    message,
    audit: {
      organizationId: input.organizationId,
      staffUserId: input.staffUserId,
      oneshotId: input.oneshotId,
      recipientHint: input.recipientHint,
      authorized: false,
      wouldSend: false,
      sent: false,
    },
  };
}

export function evaluateOwnerSelfReminderPush(input: {
  organizationId: string;
  actorStaffUserId?: string | null;
  channelId?: string | null;
  evidence?: OwnerSelfBindEvidence | null;
  independentConsent: boolean;
  testPushRecipientReused?: boolean;
  fakeCustomerId?: string | null;
  plaintextLineUserId?: string | null;
  confirmPhrase: string;
  oneshotId: string;
  oneshotConsumed?: boolean;
  killSwitchOpen: boolean;
  sentToday: number;
  recipientCount: number;
  lineQuota?: LineQuotaPublic | null;
  quotaCheckedAt?: string | null;
  channelInflight?: boolean;
  previousStatus?: string | null;
  previousErrorClass?: LineHttpErrorClass | string | null;
  previousHttpStatus?: number | null;
  env?: NodeJS.Dict<string>;
  nowMs?: number;
}): OwnerSelfReminderDecision {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const recipientHint =
    input.evidence?.hint?.startsWith("••••") ? input.evidence.hint : "••••";
  const base = {
    organizationId: input.organizationId,
    staffUserId: input.actorStaffUserId ?? "",
    oneshotId: input.oneshotId,
    recipientHint,
  };

  if (LINE_APPOINTMENT_REMINDER_OWNER_SELF_PUSH_OPEN) {
    return refuse(base, "send_closed", "店長本人測試發送開關必須維持關閉");
  }
  if (isAppointmentReminderSendOpen() || LINE_APPOINTMENT_REMINDER_SEND_OPEN) {
    return refuse(base, "send_closed", "預約提醒正式發送尚未開放");
  }
  if ((env.VERCEL_ENV ?? "").trim() === "production") {
    return refuse(base, "send_closed", "店長本人測試發送不可在 Production 開啟");
  }
  if (!isPreviewControlledEnvironment(env)) {
    return refuse(base, "send_closed", "店長本人測試發送只允許 Preview 與 Preview Supabase");
  }
  if (input.organizationId !== OWNER_SELF_REMINDER_ALLOWED_ORG_ID) {
    return refuse(base, "unauthorized", "店長本人測試發送只允許 Beauty OS TEST");
  }
  if (input.channelId !== OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID) {
    return refuse(base, "unauthorized", "只能沿用現有 THE ENJOYE LINE Channel");
  }
  if (input.recipientCount !== 1) {
    return refuse(base, "invalid_input", "只能發送給一位收件者，不能群發");
  }
  if (input.confirmPhrase.trim() !== OWNER_SELF_REMINDER_CONFIRM_PHRASE) {
    return refuse(base, "invalid_input", "請再次確認這次只發給店長本人");
  }
  if (!input.oneshotId.startsWith(OWNER_SELF_REMINDER_ONESHOT_PREFIX)) {
    return refuse(base, "invalid_input", "缺少單次授權識別");
  }
  if (!input.killSwitchOpen) {
    return refuse(base, "send_closed", "店長本人測試停止開關已關閉");
  }
  if (
    ownerSelfReminderRefusesRetry({
      oneshotConsumed: input.oneshotConsumed,
      previousStatus: input.previousStatus,
      previousErrorClass: input.previousErrorClass,
      previousHttpStatus: input.previousHttpStatus,
    })
  ) {
    return refuse(base, "duplicate", "這次單次授權已使用或結果待確認，不會重送");
  }
  if (input.sentToday >= OWNER_SELF_REMINDER_DAILY_LIMIT) {
    return refuse(base, "quota_exceeded", "今日店長本人測試發送次數已達上限");
  }

  const identity = evaluateOwnerSelfIdentity({
    organizationId: input.organizationId,
    actorStaffUserId: input.actorStaffUserId,
    evidence: input.evidence,
    independentConsent: input.independentConsent,
    testPushRecipientReused: input.testPushRecipientReused ?? input.evidence?.testPushEnabled,
    fakeCustomerId: input.fakeCustomerId,
    plaintextLineUserId: input.plaintextLineUserId,
  });
  if (!identity.ok) {
    return refuse(base, identity.reason, identity.message);
  }

  const snapshot = reminderChannelSnapshotAllowsSend({
    quota: input.lineQuota,
    quotaCheckedAt: input.quotaCheckedAt,
    nowMs: input.nowMs,
    channelInflight: input.channelInflight,
  });
  if (!snapshot.ok) {
    return refuse(
      base,
      snapshot.reason === "inflight" ? "inflight" : "quota_exceeded",
      snapshot.message,
    );
  }

  return {
    authorized: true,
    wouldSend: false,
    sent: false,
    reason: "send_closed",
    message: "檢查通過。店長本人測試發送仍關閉，沒有連接 LINE Push，也不會改 Broadcast",
    audit: {
      organizationId: input.organizationId,
      staffUserId: input.actorStaffUserId ?? "",
      oneshotId: input.oneshotId,
      recipientHint,
      authorized: true,
      wouldSend: false,
      sent: false,
    },
  };
}
