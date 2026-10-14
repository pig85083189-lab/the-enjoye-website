/**
 * Phase 2E-8 Owner-self reminder consent + oneshot. SEND stays closed.
 * Test-push bind is identity evidence only. Independent grant + oneshot
 * authorize the reminder test. Quota must come from a service-role
 * snapshot, never a client-supplied hint. This module never writes
 * remotely or calls LINE.
 */

import {
  LINE_APPOINTMENT_REMINDER_SEND_OPEN,
  isAppointmentReminderSendOpen,
} from "@/lib/line/automations/appointment-reminder-flag";
import { isLineUnknownHttpOutcome } from "@/lib/line/line-http-error";
import {
  LINE_BROADCAST_CHANNEL_LOCK_NAMESPACE,
  lineBroadcastQuotaSnapshotAllowsClaim,
} from "@/lib/line/line-channel-lock";
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
export const OWNER_SELF_REMINDER_GRANT_PREFIX = "lorg-";
export const OWNER_SELF_REMINDER_KILL_SWITCH_OPEN = false;
export const OWNER_SELF_REMINDER_FAKE_CUSTOMER_ID = "cust-2d2-fake-bound";
export const OWNER_SELF_REMINDER_PURPOSE = "owner_self_reminder_test_once";
export const OWNER_SELF_REMINDER_TEST_APPOINTMENT_ID = "apt-2e7-owner-self";
export const OWNER_SELF_REMINDER_GRANT_TTL_MS = 24 * 60 * 60_000;
export const OWNER_SELF_REMINDER_ONESHOT_TTL_MS = 2 * 60 * 60_000;
export const OWNER_SELF_REMINDER_SQL_DRAFT =
  "supabase/drafts/20261014180000_line_owner_self_reminder_grant.sql";

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

export type OwnerSelfReminderGrant = {
  id: string;
  organizationId: string;
  staffUserId: string;
  channelId: string;
  purpose: string;
  appointmentId: string;
  bindBoundAt: string;
  bindHint: string;
  bindKeyId: string;
  acknowledgedOnceOnly: boolean;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  authorizedViaTestPush?: boolean;
};

export type OwnerSelfReminderOneshot = {
  id: string;
  grantId: string;
  organizationId: string;
  staffUserId: string;
  channelId: string;
  appointmentId: string;
  bindBoundAt: string;
  bindHint?: string;
  bindKeyId?: string;
  status: "issued" | "claimed" | "accepted" | "pending_confirmation" | "expired" | "canceled";
  expiresAt: string;
  claimedAt?: string | null;
  consumedAt?: string | null;
};

export type OwnerSelfTrustedQuotaSnapshot = {
  source: "service_role_snapshot";
  channelId: string;
  known: true;
  remaining: number | null;
  checkedAt: string;
};

export type OwnerSelfReminderView = {
  visible: boolean;
  organizationId: string;
  channelLast4: string;
  ownerBindPresent: boolean;
  ownerBindHint: string;
  ownerBindReusableAsReminder: false;
  independentConsent: boolean;
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

export function newOwnerSelfReminderGrantId(
  random: () => string = () => crypto.randomUUID(),
): string {
  return `${OWNER_SELF_REMINDER_GRANT_PREFIX}${random().replace(/-/g, "").slice(0, 16)}`;
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
 * testPushEnabled may be true; it never grants reminder consent.
 */
export function evaluateOwnerSelfIdentity(input: {
  organizationId: string;
  actorStaffUserId?: string | null;
  evidence?: OwnerSelfBindEvidence | null;
  fakeCustomerId?: string | null;
  plaintextLineUserId?: string | null;
}): { ok: true } | { ok: false; reason: OwnerSelfReminderReason; message: string } {
  if (input.plaintextLineUserId) {
    return { ok: false, reason: "invalid_recipient", message: "不能手動填入 LINE userId" };
  }
  if (input.fakeCustomerId === OWNER_SELF_REMINDER_FAKE_CUSTOMER_ID) {
    return { ok: false, reason: "invalid_recipient", message: "不能使用假綁定客人作為店長本人收件者" };
  }
  const evidence = input.evidence;
  if (!evidence) {
    return { ok: false, reason: "unbound", message: "尚未有官方 Webhook 驗證的店長 LINE 綁定" };
  }
  if (evidence.organizationId !== input.organizationId) {
    return { ok: false, reason: "unauthorized", message: "不能使用其他店家的店長 LINE 綁定" };
  }
  if (evidence.bindMethod !== "webhook_code" || !evidence.boundAt) {
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
  return { ok: true };
}

export function createOwnerSelfReminderGrantDraft(input: {
  organizationId: string;
  staffUserId: string;
  evidence: OwnerSelfBindEvidence;
  nowMs?: number;
  random?: () => string;
}): OwnerSelfReminderGrant {
  const nowMs = input.nowMs ?? Date.now();
  return {
    id: newOwnerSelfReminderGrantId(input.random),
    organizationId: input.organizationId,
    staffUserId: input.staffUserId,
    channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
    purpose: OWNER_SELF_REMINDER_PURPOSE,
    appointmentId: OWNER_SELF_REMINDER_TEST_APPOINTMENT_ID,
    bindBoundAt: input.evidence.boundAt ?? "",
    bindHint: input.evidence.hint,
    bindKeyId: input.evidence.keyId ?? "",
    acknowledgedOnceOnly: true,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + OWNER_SELF_REMINDER_GRANT_TTL_MS).toISOString(),
    revokedAt: null,
    authorizedViaTestPush: false,
  };
}

export function createOwnerSelfReminderOneshotDraft(input: {
  grant: OwnerSelfReminderGrant;
  nowMs?: number;
  random?: () => string;
}): OwnerSelfReminderOneshot {
  const nowMs = input.nowMs ?? Date.now();
  return {
    id: newOwnerSelfReminderOneshotId(input.random),
    grantId: input.grant.id,
    organizationId: input.grant.organizationId,
    staffUserId: input.grant.staffUserId,
    channelId: input.grant.channelId,
    appointmentId: input.grant.appointmentId,
    bindBoundAt: input.grant.bindBoundAt,
    bindHint: input.grant.bindHint,
    bindKeyId: input.grant.bindKeyId,
    status: "issued",
    expiresAt: new Date(nowMs + OWNER_SELF_REMINDER_ONESHOT_TTL_MS).toISOString(),
  };
}

export function ownerSelfReminderChannelLockSpec(): {
  namespace: number;
  channelId: string;
  lockAllOrgsOnChannel: true;
  usesBroadcastInflight: true;
} {
  return {
    namespace: LINE_BROADCAST_CHANNEL_LOCK_NAMESPACE,
    channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
    lockAllOrgsOnChannel: true,
    usesBroadcastInflight: true,
  };
}

export function evaluateOwnerSelfTrustedQuota(input: {
  snapshot?: OwnerSelfTrustedQuotaSnapshot | null;
  authorizeWithClientQuota?: boolean;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: "quota_exceeded"; message: string } {
  if (input.authorizeWithClientQuota) {
    return { ok: false, reason: "quota_exceeded", message: "不能信任呼叫端自填的 LINE 額度" };
  }
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.source !== "service_role_snapshot" || snapshot.known !== true) {
    return { ok: false, reason: "quota_exceeded", message: "LINE 額度未知時拒絕發送" };
  }
  if (snapshot.channelId !== OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID) {
    return { ok: false, reason: "quota_exceeded", message: "LINE 額度快照與授權 Channel 不符" };
  }
  return lineBroadcastQuotaSnapshotAllowsClaim({
    quotaKnown: true,
    quotaRemaining: snapshot.remaining,
    quotaCheckedAt: snapshot.checkedAt,
    nowMs: input.nowMs,
  });
}

export function evaluateOwnerSelfRevoke(input: {
  organizationId: string;
  actorStaffUserId?: string | null;
  grant?: OwnerSelfReminderGrant | null;
}): { ok: true } | { ok: false; reason: OwnerSelfReminderReason; message: string } {
  if (!input.grant) {
    return { ok: false, reason: "not_consented", message: "找不到店長本人測試同意" };
  }
  if (
    input.grant.organizationId !== input.organizationId ||
    !input.actorStaffUserId ||
    input.grant.staffUserId !== input.actorStaffUserId
  ) {
    return { ok: false, reason: "unauthorized", message: "非本人不能撤回這次店長本人測試同意" };
  }
  return { ok: true };
}

export function evaluateOwnerSelfGrant(input: {
  organizationId: string;
  actorStaffUserId?: string | null;
  channelId?: string | null;
  evidence?: OwnerSelfBindEvidence | null;
  grant?: OwnerSelfReminderGrant | null;
  clientAcknowledged?: boolean;
  authorizeWithTestPushEnabled?: boolean;
  trustClientGrant?: boolean;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: OwnerSelfReminderReason; message: string } {
  if (input.trustClientGrant) {
    return {
      ok: false,
      reason: "not_consented",
      message: "不能接受前端自製授權物件作為唯一證據",
    };
  }
  if (input.authorizeWithTestPushEnabled) {
    return {
      ok: false,
      reason: "not_consented",
      message: "不能用店長 test-push 啟用狀態當作預約提醒同意",
    };
  }
  const grant = input.grant;
  if (!grant) {
    return {
      ok: false,
      reason: "not_consented",
      message: input.clientAcknowledged
        ? "前端勾選不能代替伺服器授權列"
        : "尚未另外同意這次預約提醒測試，不能沿用 test-push 或店長角色",
    };
  }
  if (grant.authorizedViaTestPush) {
    return {
      ok: false,
      reason: "not_consented",
      message: "不能用店長 test-push 啟用狀態當作預約提醒同意",
    };
  }
  if (
    grant.organizationId !== input.organizationId ||
    grant.staffUserId !== input.actorStaffUserId ||
    grant.channelId !== input.channelId
  ) {
    return { ok: false, reason: "unauthorized", message: "授權必須精確符合店家、店長與 Channel" };
  }
  if (grant.purpose !== OWNER_SELF_REMINDER_PURPOSE || !grant.acknowledgedOnceOnly) {
    return { ok: false, reason: "not_consented", message: "這次授權不是單次預約提醒測試" };
  }
  if (grant.appointmentId !== OWNER_SELF_REMINDER_TEST_APPOINTMENT_ID) {
    return { ok: false, reason: "invalid_input", message: "只能授權固定的一筆測試預約" };
  }
  if (grant.revokedAt) {
    return { ok: false, reason: "not_consented", message: "店長本人測試同意已撤回" };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (Date.parse(grant.expiresAt) <= nowMs) {
    return { ok: false, reason: "not_consented", message: "店長本人測試同意已過期" };
  }
  const evidence = input.evidence;
  if (
    !evidence ||
    grant.bindBoundAt !== evidence.boundAt ||
    grant.bindHint !== evidence.hint ||
    grant.bindKeyId !== evidence.keyId
  ) {
    return { ok: false, reason: "not_consented", message: "重新綁定後舊的測試同意已失效" };
  }
  return { ok: true };
}

export function evaluateOwnerSelfOneshotClaim(input: {
  oneshot?: OwnerSelfReminderOneshot | null;
  grant?: OwnerSelfReminderGrant | null;
  evidence?: OwnerSelfBindEvidence | null;
  appointmentId?: string | null;
  oneshotConsumed?: boolean;
  previousStatus?: string | null;
  previousErrorClass?: LineHttpErrorClass | string | null;
  previousHttpStatus?: number | null;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: OwnerSelfReminderReason; message: string } {
  const oneshot = input.oneshot;
  if (!oneshot || !oneshot.id.startsWith(OWNER_SELF_REMINDER_ONESHOT_PREFIX)) {
    return { ok: false, reason: "invalid_input", message: "缺少單次授權識別" };
  }
  if (!input.grant || oneshot.grantId !== input.grant.id) {
    return { ok: false, reason: "invalid_input", message: "單次授權與同意列不符" };
  }
  if (input.grant.purpose !== OWNER_SELF_REMINDER_PURPOSE) {
    return { ok: false, reason: "not_consented", message: "這次授權不是單次預約提醒測試" };
  }
  if (input.grant.revokedAt) {
    return { ok: false, reason: "not_consented", message: "店長本人測試同意已撤回" };
  }
  if (
    oneshot.organizationId !== input.grant.organizationId ||
    oneshot.staffUserId !== input.grant.staffUserId ||
    oneshot.channelId !== input.grant.channelId ||
    oneshot.bindBoundAt !== input.grant.bindBoundAt ||
    (oneshot.bindHint != null && oneshot.bindHint !== input.grant.bindHint) ||
    (oneshot.bindKeyId != null && oneshot.bindKeyId !== input.grant.bindKeyId)
  ) {
    return { ok: false, reason: "duplicate", message: "單次授權不能在更改收件者後重用" };
  }
  if (
    oneshot.appointmentId !== OWNER_SELF_REMINDER_TEST_APPOINTMENT_ID ||
    input.grant.appointmentId !== OWNER_SELF_REMINDER_TEST_APPOINTMENT_ID ||
    (input.appointmentId && input.appointmentId !== oneshot.appointmentId)
  ) {
    return { ok: false, reason: "invalid_input", message: "單次授權只能用於固定的測試預約" };
  }
  if (
    input.evidence &&
    (oneshot.bindBoundAt !== input.evidence.boundAt ||
      (oneshot.bindHint != null && oneshot.bindHint !== input.evidence.hint) ||
      (oneshot.bindKeyId != null && oneshot.bindKeyId !== input.evidence.keyId))
  ) {
    return { ok: false, reason: "duplicate", message: "單次授權不能在更改收件者後重用" };
  }
  if (oneshot.consumedAt || input.oneshotConsumed || oneshot.status === "claimed") {
    return { ok: false, reason: "duplicate", message: "這次單次授權已使用或結果待確認，不會重送" };
  }
  if (
    ownerSelfReminderRefusesRetry({
      oneshotConsumed: input.oneshotConsumed,
      previousStatus: input.previousStatus ?? oneshot.status,
      previousErrorClass: input.previousErrorClass,
      previousHttpStatus: input.previousHttpStatus,
    })
  ) {
    return { ok: false, reason: "duplicate", message: "這次單次授權已使用或結果待確認，不會重送" };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (Date.parse(oneshot.expiresAt) <= nowMs || oneshot.status === "expired") {
    return { ok: false, reason: "duplicate", message: "單次授權已過期，不會重送" };
  }
  return { ok: true };
}

export function buildOwnerSelfReminderView(input: {
  organizationId: string;
  evidence?: OwnerSelfBindEvidence | null;
  grant?: OwnerSelfReminderGrant | null;
  oneshotId?: string;
  quotaLabel?: string;
  nowMs?: number;
}): OwnerSelfReminderView {
  const evidence = input.evidence;
  const grantOk = evaluateOwnerSelfGrant({
    organizationId: input.organizationId,
    actorStaffUserId: evidence?.staffUserId,
    channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
    evidence,
    grant: input.grant,
    nowMs: input.nowMs,
  }).ok;
  return {
    visible: isOwnerSelfReminderPanelVisible(input.organizationId),
    organizationId: OWNER_SELF_REMINDER_ALLOWED_ORG_ID,
    channelLast4: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID.slice(-4),
    ownerBindPresent: Boolean(evidence?.bindMethod === "webhook_code" && evidence.hint),
    ownerBindHint: evidence?.hint?.startsWith("••••") ? evidence.hint : "••••",
    ownerBindReusableAsReminder: false,
    independentConsent: grantOk,
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
  grant?: OwnerSelfReminderGrant | null;
  oneshot?: OwnerSelfReminderOneshot | null;
  clientAcknowledged?: boolean;
  authorizeWithTestPushEnabled?: boolean;
  trustClientGrant?: boolean;
  trustedQuotaSnapshot?: OwnerSelfTrustedQuotaSnapshot | null;
  authorizeWithClientQuota?: boolean;
  fakeCustomerId?: string | null;
  plaintextLineUserId?: string | null;
  confirmPhrase: string;
  oneshotId: string;
  oneshotConsumed?: boolean;
  killSwitchOpen: boolean;
  sentToday: number;
  recipientCount: number;
  appointmentId?: string | null;
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
  if (input.sentToday >= OWNER_SELF_REMINDER_DAILY_LIMIT) {
    return refuse(base, "quota_exceeded", "今日店長本人測試發送次數已達上限");
  }

  const identity = evaluateOwnerSelfIdentity({
    organizationId: input.organizationId,
    actorStaffUserId: input.actorStaffUserId,
    evidence: input.evidence,
    fakeCustomerId: input.fakeCustomerId,
    plaintextLineUserId: input.plaintextLineUserId,
  });
  if (!identity.ok) {
    return refuse(base, identity.reason, identity.message);
  }

  const consent = evaluateOwnerSelfGrant({
    organizationId: input.organizationId,
    actorStaffUserId: input.actorStaffUserId,
    channelId: input.channelId,
    evidence: input.evidence,
    grant: input.grant,
    clientAcknowledged: input.clientAcknowledged,
    authorizeWithTestPushEnabled: input.authorizeWithTestPushEnabled,
    trustClientGrant: input.trustClientGrant,
    nowMs: input.nowMs,
  });
  if (!consent.ok) {
    return refuse(base, consent.reason, consent.message);
  }

  const oneshot = evaluateOwnerSelfOneshotClaim({
    oneshot: input.oneshot,
    grant: input.grant,
    evidence: input.evidence,
    appointmentId: input.appointmentId ?? OWNER_SELF_REMINDER_TEST_APPOINTMENT_ID,
    oneshotConsumed: input.oneshotConsumed,
    previousStatus: input.previousStatus,
    previousErrorClass: input.previousErrorClass,
    previousHttpStatus: input.previousHttpStatus,
    nowMs: input.nowMs,
  });
  if (!oneshot.ok) {
    return refuse(base, oneshot.reason, oneshot.message);
  }

  if (input.channelInflight) {
    return refuse(base, "inflight", "同一 LINE Channel 尚有發送進行中，已停止以免超額");
  }

  const snapshot = evaluateOwnerSelfTrustedQuota({
    snapshot: input.trustedQuotaSnapshot,
    authorizeWithClientQuota: input.authorizeWithClientQuota,
    nowMs: input.nowMs,
  });
  if (!snapshot.ok) {
    return refuse(base, snapshot.reason, snapshot.message);
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
