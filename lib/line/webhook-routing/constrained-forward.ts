/**
 * Phase 2F-6 split-environment forward design (local prototype).
 *
 * Preview and Production never share a Set, transaction, or secret.
 * A Preview miss is not a Production hit. Uniqueness is proven by code
 * namespace, not by reading both databases. Does not send or bind a URL.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  extractLineWebhookTextEvents,
  hashLineBindCode,
  normalizeLineBindCode,
  selectLineWebhookBindCandidate,
} from "@/lib/line/line-bind";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

export type ForwardEnvironment = "preview" | "production";
export type Phase2F6Architecture = "A_neutral_gateway" | "B_constrained_forward" | "C_separate_channels";
export type UniquenessProof = "code_namespace" | "none";

export const TEST_CODE_NAMESPACE = /^[0-7][0-9A-F]{7}$/;
export const ENJOYE_CODE_NAMESPACE = /^[8-F][0-9A-F]{7}$/;
export const PHASE_2F6_RECOMMENDED: Phase2F6Architecture = "C_separate_channels";

const LOCAL_SECRET = "local-2f6-channel-secret";

export type SplitChallenge = {
  id: string;
  organizationId: string;
  staffUserId: string;
  codeHash: string;
  expiresAtMs: number;
  consumed: boolean;
};

export type SplitStore = {
  environment: ForwardEnvironment;
  available: boolean;
  challenges: SplitChallenge[];
  claimedEvents: Set<string>;
  recipients: Array<{ organizationId: string; staffUserId: string; eventId: string }>;
  audits: Array<{ action: string; eventId?: string; organizationId?: string }>;
};

export type PreviewDecision =
  | { action: "consume_test"; eventId: string; staffUserId: string }
  | { action: "forward_candidate"; eventId: string; code: string }
  | { action: "reject"; reason: "unauthorized" | "unknown" | "unavailable" | "unproven" | "duplicate" | "send_closed"; message: string };

export type ProductionDecision =
  | { action: "consume_enjoye"; eventId: string; staffUserId: string }
  | { action: "reject"; reason: "unauthorized" | "unknown" | "unavailable" | "unproven" | "duplicate" | "timeout" | "send_closed"; message: string };

export function phase2F6FlagsClosed(): boolean {
  return (
    LINE_BROADCAST_SEND_OPEN === false &&
    LINE_AUTOMATION_SEND_OPEN === false &&
    LINE_OWNER_SELF_PUSH_OPEN === false &&
    LINE_AUTOMATION_KILL_SWITCH === false &&
    LINE_OWNER_SELF_GRANT_PERSIST_OPEN === false
  );
}

export function createSplitStore(environment: ForwardEnvironment): SplitStore {
  return {
    environment,
    available: true,
    challenges: [],
    claimedEvents: new Set(),
    recipients: [],
    audits: [],
  };
}

export function codeNamespaceForOrganization(organizationId: string): RegExp | null {
  if (organizationId === ORG_BEAUTY_OS_TEST_ID) return TEST_CODE_NAMESPACE;
  if (organizationId === ORG_ENJOYE_ID) return ENJOYE_CODE_NAMESPACE;
  return null;
}

export function canProveBindCodeUniqueness(
  code: string,
  organizationId: string,
  proof: UniquenessProof = "code_namespace",
): boolean {
  if (proof !== "code_namespace") return false;
  const normalized = normalizeLineBindCode(code);
  const namespace = codeNamespaceForOrganization(organizationId);
  return Boolean(normalized && namespace?.test(normalized));
}

export function issueSplitChallenge(input: {
  store: SplitStore;
  organizationId: string;
  staffUserId: string;
  code: string;
  nowMs?: number;
  uniquenessProof?: UniquenessProof;
}): SplitChallenge | null {
  if (input.store.environment === "preview" && input.organizationId !== ORG_BEAUTY_OS_TEST_ID) {
    return null;
  }
  if (input.store.environment === "production" && input.organizationId !== ORG_ENJOYE_ID) {
    return null;
  }
  if (!canProveBindCodeUniqueness(input.code, input.organizationId, input.uniquenessProof)) return null;
  const code = normalizeLineBindCode(input.code);
  if (!code) return null;
  const row: SplitChallenge = {
    id: `lbc-2f6-${input.store.challenges.length + 1}`,
    organizationId: input.organizationId,
    staffUserId: input.staffUserId,
    codeHash: hashLineBindCode(input.organizationId, code),
    expiresAtMs: (input.nowMs ?? Date.now()) + 10 * 60 * 1000,
    consumed: false,
  };
  input.store.challenges.push(row);
  input.store.audits.push({ action: "challenge_issued", organizationId: input.organizationId });
  return row;
}

export function signLocalWebhookBody(rawBody: string, secret = LOCAL_SECRET): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  const provided = (signature ?? "").trim();
  if (!provided || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseBind(rawBody: string): { eventId: string; code: string } | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
  const events = extractLineWebhookTextEvents(payload);
  const candidate = selectLineWebhookBindCandidate(events);
  const event = events.find((row) => selectLineWebhookBindCandidate([row]));
  if (!candidate || !event?.eventId) return null;
  return { eventId: event.eventId, code: candidate.code };
}

function claimEvent(store: SplitStore, eventId: string): boolean {
  if (store.claimedEvents.has(eventId)) return false;
  store.claimedEvents.add(eventId);
  return true;
}

export function previewHandleWebhook(input: {
  store: SplitStore;
  rawBody: string;
  signature: string | null;
  secret?: string;
  nowMs?: number;
  uniquenessProof?: UniquenessProof;
}): PreviewDecision {
  if (!phase2F6FlagsClosed()) {
    return { action: "reject", reason: "send_closed", message: "發送開關被意外開啟" };
  }
  if (!verifySignature(input.rawBody, input.signature, input.secret ?? LOCAL_SECRET)) {
    return { action: "reject", reason: "unauthorized", message: "LINE 簽章驗證失敗" };
  }
  const parsed = parseBind(input.rawBody);
  if (!parsed) {
    return { action: "reject", reason: "unknown", message: "未知事件，不轉送也不消耗" };
  }
  if (!input.store.available) {
    return { action: "reject", reason: "unavailable", message: "Preview 資料庫不可用，已 fail closed" };
  }
  if (input.store.claimedEvents.has(parsed.eventId)) {
    return { action: "reject", reason: "duplicate", message: "Preview 已見過此事件" };
  }
  const proof = input.uniquenessProof ?? "code_namespace";
  if (proof === "none") {
    return { action: "reject", reason: "unproven", message: "無法證明驗證碼全 Channel 唯一，已拒絕" };
  }
  if (ENJOYE_CODE_NAMESPACE.test(parsed.code)) {
    return { action: "forward_candidate", eventId: parsed.eventId, code: parsed.code };
  }
  if (!TEST_CODE_NAMESPACE.test(parsed.code)) {
    return { action: "reject", reason: "unproven", message: "無法證明驗證碼全 Channel 唯一，已拒絕" };
  }
  const nowMs = input.nowMs ?? Date.now();
  const hit = input.store.challenges.find(
    (row) =>
      !row.consumed &&
      row.expiresAtMs > nowMs &&
      row.organizationId === ORG_BEAUTY_OS_TEST_ID &&
      row.codeHash === hashLineBindCode(ORG_BEAUTY_OS_TEST_ID, parsed.code),
  );
  if (!hit) {
    return { action: "reject", reason: "unknown", message: "TEST 未命中。這不是 Production 命中" };
  }
  if (!claimEvent(input.store, parsed.eventId)) {
    return { action: "reject", reason: "duplicate", message: "Preview 已見過此事件" };
  }
  hit.consumed = true;
  input.store.recipients.push({
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    staffUserId: hit.staffUserId,
    eventId: parsed.eventId,
  });
  input.store.audits.push({
    action: "consume_test",
    eventId: parsed.eventId,
    organizationId: ORG_BEAUTY_OS_TEST_ID,
  });
  return { action: "consume_test", eventId: parsed.eventId, staffUserId: hit.staffUserId };
}

export function productionHandleForward(input: {
  store: SplitStore;
  rawBody: string;
  signature: string | null;
  secret?: string;
  nowMs?: number;
  timedOut?: boolean;
  uniquenessProof?: UniquenessProof;
}): ProductionDecision {
  if (!phase2F6FlagsClosed()) {
    return { action: "reject", reason: "send_closed", message: "發送開關被意外開啟" };
  }
  if (input.timedOut) {
    return { action: "reject", reason: "timeout", message: "轉送超時，已 fail closed" };
  }
  if (!verifySignature(input.rawBody, input.signature, input.secret ?? LOCAL_SECRET)) {
    return { action: "reject", reason: "unauthorized", message: "Production 重驗簽章失敗" };
  }
  const parsed = parseBind(input.rawBody);
  if (!parsed) {
    return { action: "reject", reason: "unknown", message: "未知事件，Production 不綁定" };
  }
  if (!input.store.available) {
    return { action: "reject", reason: "unavailable", message: "Production 資料庫不可用，已 fail closed" };
  }
  if (!canProveBindCodeUniqueness(parsed.code, ORG_ENJOYE_ID, input.uniquenessProof)) {
    return { action: "reject", reason: "unproven", message: "無法證明驗證碼全 Channel 唯一，已拒絕" };
  }
  if (!claimEvent(input.store, parsed.eventId)) {
    return { action: "reject", reason: "duplicate", message: "同一 webhookEventId 不可跨次綁定" };
  }
  const nowMs = input.nowMs ?? Date.now();
  const hit = input.store.challenges.find(
    (row) =>
      !row.consumed &&
      row.expiresAtMs > nowMs &&
      row.organizationId === ORG_ENJOYE_ID &&
      row.codeHash === hashLineBindCode(ORG_ENJOYE_ID, parsed.code),
  );
  if (!hit) {
    input.store.audits.push({ action: "forward_miss", eventId: parsed.eventId });
    return { action: "reject", reason: "unknown", message: "Preview 未命中不是 Production 命中" };
  }
  hit.consumed = true;
  input.store.recipients.push({
    organizationId: ORG_ENJOYE_ID,
    staffUserId: hit.staffUserId,
    eventId: parsed.eventId,
  });
  input.store.audits.push({
    action: "consume_enjoye",
    eventId: parsed.eventId,
    organizationId: ORG_ENJOYE_ID,
  });
  return { action: "consume_enjoye", eventId: parsed.eventId, staffUserId: hit.staffUserId };
}

export function executeConstrainedForward(input: {
  preview: SplitStore;
  production: SplitStore;
  rawBody: string;
  signature: string | null;
  nowMs?: number;
  network?: "ok" | "timeout" | "offline_production";
  uniquenessProof?: UniquenessProof;
}): { preview: PreviewDecision; production: ProductionDecision | null } {
  const preview = previewHandleWebhook({
    store: input.preview,
    rawBody: input.rawBody,
    signature: input.signature,
    nowMs: input.nowMs,
    uniquenessProof: input.uniquenessProof,
  });
  if (preview.action !== "forward_candidate") {
    return { preview, production: null };
  }
  if (input.network === "timeout") {
    return {
      preview,
      production: productionHandleForward({
        store: input.production,
        rawBody: input.rawBody,
        signature: input.signature,
        nowMs: input.nowMs,
        timedOut: true,
        uniquenessProof: input.uniquenessProof,
      }),
    };
  }
  if (input.network === "offline_production") {
    input.production.available = false;
  }
  return {
    preview,
    production: productionHandleForward({
      store: input.production,
      rawBody: input.rawBody,
      signature: input.signature,
      nowMs: input.nowMs,
      uniquenessProof: input.uniquenessProof,
    }),
  };
}

export function planBSafelyLandableWithoutCoordinator(): boolean {
  return false;
}

export function comparePhase2F6Architectures(): {
  recommended: Phase2F6Architecture;
  planBLandable: boolean;
  keepOfficialBroadcastChannel: boolean;
  rows: Array<{ id: Phase2F6Architecture; safety: string; complexity: string; broadcast: string; saas: string }>;
} {
  return {
    recommended: PHASE_2F6_RECOMMENDED,
    planBLandable: false,
    keepOfficialBroadcastChannel: true,
    rows: [
      {
        id: "A_neutral_gateway",
        safety: "兩庫分離時看不到全 Channel challenge，本機 Set 去重不能當遠端保證",
        complexity: "高：新主機、雙 RPC、仍要全域唯一性",
        broadcast: "不改發送程式",
        saas: "同庫多店後較適合",
      },
      {
        id: "B_constrained_forward",
        safety: "需驗證碼命名空間才能證明唯一；超時/5xx 必須 fail closed；公開入口需重驗簽章",
        complexity: "高：轉送、重驗、雙邊去重、命名空間",
        broadcast: "不改發送程式，但仍共用 Channel lock",
        saas: "過渡；維護負擔高",
      },
      {
        id: "C_separate_channels",
        safety: "TEST 與 Enjoye 不再共用 Webhook 或驗證碼空間",
        complexity: "低：新測試 Channel，正式 Channel 只服務 Enjoye",
        broadcast: "正式群發留在 2009219238，不改發送程式",
        saas: "一店一 Channel 或同庫多店再做 Gateway",
      },
    ],
  };
}
