/**
 * Phase 2F-1 Production Owner-self reminder design.
 * Pure decisions only. Does not call LINE, RPCs, or persist.
 * SEND / OWNER_SELF_PUSH / GRANT persist stay closed.
 */
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import { lineQuotaBlocksSend } from "@/lib/line/line-quota";
import type { LineQuotaPublic } from "@/lib/line/line-types";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";

export const OWNER_SELF_PRODUCTION_ORG_ID = ORG_ENJOYE_ID;
export const OWNER_SELF_PRODUCTION_CHANNEL_ID = "2009219238";
export const OWNER_SELF_PRODUCTION_PURPOSE = "owner_self_reminder_test_once";
export const OWNER_SELF_PRODUCTION_SUPABASE_HOST = "knccefcxncglgpmvgqlp.supabase.co";
export const OWNER_SELF_PREVIEW_SUPABASE_HOST = "bfzquejrtgqzzarhkiya.supabase.co";
export const OWNER_SELF_PRODUCTION_CONFIRM_PHRASE =
  "確認發送一則給我自己的預約提醒測試";
export const OWNER_SELF_FORBIDDEN_APPOINTMENT_ID = "apt-2e7-owner-self";
export const OWNER_SELF_FORBIDDEN_FAKE_CUSTOMER_ID = "cust-2d2-fake-bound";

export type OwnerSelfProductionReason =
  | "ok"
  | "unauthorized"
  | "unbound"
  | "not_consented"
  | "invalid_input"
  | "duplicate"
  | "quota_unknown"
  | "send_closed"
  | "inflight"
  | "expired"
  | "revoked"
  | "rebound";

export type OwnerSelfProductionDecision = {
  ok: boolean;
  authorized: boolean;
  reason: OwnerSelfProductionReason;
  message: string;
};

export type OwnerSelfProductionBind = {
  organizationId?: string | null;
  staffUserId?: string | null;
  bindMethod?: string | null;
  hint?: string | null;
  boundAt?: string | null;
  keyId?: string | null;
  webhookVerified?: boolean;
};

export type OwnerSelfProductionActor = {
  organizationId?: string | null;
  staffUserId?: string | null;
  role?: string | null;
  isActive?: boolean;
};

function decide(
  reason: OwnerSelfProductionReason,
  message: string,
  authorized = false,
): OwnerSelfProductionDecision {
  return { ok: reason === "ok", authorized, reason, message };
}

export function isForbiddenPreviewFixture(value?: string | null): boolean {
  const id = (value ?? "").trim();
  return (
    id === ORG_BEAUTY_OS_TEST_ID ||
    id === OWNER_SELF_FORBIDDEN_APPOINTMENT_ID ||
    id === OWNER_SELF_FORBIDDEN_FAKE_CUSTOMER_ID ||
    id === OWNER_SELF_PREVIEW_SUPABASE_HOST
  );
}

export function evaluateOwnerSelfProductionRuntime(input: {
  supabaseHost?: string | null;
  runtime?: string | null;
  vercelEnv?: string | null;
}): OwnerSelfProductionDecision {
  const host = (input.supabaseHost ?? "").trim();
  const runtime = (input.runtime ?? "").trim();
  const vercelEnv = (input.vercelEnv ?? "").trim();
  if (host === OWNER_SELF_PREVIEW_SUPABASE_HOST || runtime === "preview") {
    return decide("send_closed", "不可把 Preview runtime identity 搬到正式環境");
  }
  if (
    host !== OWNER_SELF_PRODUCTION_SUPABASE_HOST ||
    runtime !== "production" ||
    (vercelEnv && vercelEnv !== "production")
  ) {
    return decide("send_closed", "正式授權只允許已確認的 Production Supabase");
  }
  return decide("ok", "正式 runtime 主機已確認", false);
}

export function evaluateOwnerSelfProductionIdentity(input: {
  actor: OwnerSelfProductionActor;
  bind: OwnerSelfProductionBind;
}): OwnerSelfProductionDecision {
  const organizationId = (input.actor.organizationId ?? "").trim();
  if (isForbiddenPreviewFixture(organizationId)) {
    return decide("unauthorized", "正式授權不可使用 Preview TEST 店家");
  }
  if (organizationId !== OWNER_SELF_PRODUCTION_ORG_ID) {
    return decide("unauthorized", "正式授權只允許 THE ENJOYE 店長本人");
  }
  if (input.actor.role !== "OWNER" || input.actor.isActive !== true) {
    return decide("unauthorized", "只有在職店長可以使用正式本人授權");
  }
  const actorStaff = (input.actor.staffUserId ?? "").trim();
  const bindStaff = (input.bind.staffUserId ?? "").trim();
  if (!actorStaff || actorStaff.includes("@") || actorStaff.length < 3) {
    return decide("unauthorized", "缺少正式店長 operational staff id");
  }
  if (isForbiddenPreviewFixture(input.bind.organizationId) || isForbiddenPreviewFixture(bindStaff)) {
    return decide("unbound", "假綁定或 Preview 身分不可用");
  }
  if ((input.bind.organizationId ?? "").trim() !== organizationId) {
    return decide("unauthorized", "不可跨店操作正式本人授權");
  }
  if (
    input.bind.bindMethod !== "webhook_code" ||
    input.bind.webhookVerified !== true ||
    !input.bind.hint?.startsWith("••••") ||
    !input.bind.boundAt ||
    input.bind.keyId !== "line-cred-v1"
  ) {
    return decide("unbound", "必須使用官方 Webhook 驗證的店長本人綁定");
  }
  if (!bindStaff || bindStaff !== actorStaff) {
    return decide("unbound", "綁定必須屬於目前登入的店長本人");
  }
  return decide("ok", "正式店長本人綁定可驗證", false);
}

export function evaluateOwnerSelfProductionGrant(input: {
  actor: OwnerSelfProductionActor;
  bind: OwnerSelfProductionBind;
  acknowledgedOnceOnly: boolean;
  appointmentId?: string | null;
  persistOpen?: boolean;
}): OwnerSelfProductionDecision {
  if (isForbiddenPreviewFixture(input.appointmentId)) {
    return decide("invalid_input", "不可使用 Preview 假預約作為正式授權依據");
  }
  const identity = evaluateOwnerSelfProductionIdentity(input);
  if (!identity.ok) return identity;
  if (input.acknowledgedOnceOnly !== true) {
    return decide("not_consented", "必須主動同意這是只限一次的預約提醒測試");
  }
  if (input.persistOpen !== true || LINE_OWNER_SELF_GRANT_PERSIST_OPEN !== false) {
    return decide("send_closed", "正式授權寫入尚未開放");
  }
  return decide("send_closed", "正式授權寫入尚未開放");
}

export function evaluateOwnerSelfProductionOneshot(input: {
  grantOpen: boolean;
  grantExpired: boolean;
  grantRevoked: boolean;
  bindStillMatches: boolean;
  existingOpenOneshot: boolean;
}): OwnerSelfProductionDecision {
  if (input.grantRevoked) {
    return decide("revoked", "同意已撤回，單次授權立即失效");
  }
  if (input.grantExpired) {
    return decide("expired", "授權已過期");
  }
  if (!input.grantOpen) {
    return decide("not_consented", "沒有獨立同意不能發行單次授權");
  }
  if (!input.bindStillMatches) {
    return decide("rebound", "換綁定或解除綁定後，既有授權立即失效");
  }
  if (input.existingOpenOneshot) {
    return decide("duplicate", "重複 oneshot 不可用");
  }
  return decide("send_closed", "正式單次授權發行尚未開放");
}

export function evaluateOwnerSelfProductionSend(input: {
  quota: LineQuotaPublic;
  oneshotOpen: boolean;
  broadcastInflight: boolean;
}): OwnerSelfProductionDecision {
  if (LINE_AUTOMATION_SEND_OPEN || LINE_OWNER_SELF_PUSH_OPEN || LINE_AUTOMATION_KILL_SWITCH) {
    return decide("send_closed", "正式發送開關被意外開啟，已拒絕");
  }
  if (LINE_BROADCAST_SEND_OPEN !== false) {
    return decide("send_closed", "Broadcast 發送開關必須維持關閉");
  }
  if (!input.oneshotOpen) {
    return decide("not_consented", "沒有獨立同意與單次授權不能發送");
  }
  if (input.broadcastInflight) {
    return decide("inflight", "同一 LINE Channel 尚有 Broadcast 進行中");
  }
  if (lineQuotaBlocksSend(input.quota) || input.quota.known !== true) {
    return decide("quota_unknown", "LINE 額度未知時拒絕發送");
  }
  return decide("send_closed", "正式發送、店長本人測試與停止開關都關閉");
}

export function ownerSelfProductionFlagsClosed(): boolean {
  return (
    LINE_AUTOMATION_SEND_OPEN === false &&
    LINE_OWNER_SELF_PUSH_OPEN === false &&
    LINE_AUTOMATION_KILL_SWITCH === false &&
    LINE_OWNER_SELF_GRANT_PERSIST_OPEN === false &&
    LINE_BROADCAST_SEND_OPEN === false
  );
}
