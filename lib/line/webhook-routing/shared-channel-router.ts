/**
 * Phase 2F-5 isolated shared-channel webhook router (local prototype).
 * Does not read Production/Preview secrets, does not bind a real URL, does not send.
 *
 * URL organization is admission-only. Consume follows the challenge's own
 * environment + organization + staff, after Channel-secret signature verify.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  hashLineBindCode,
  normalizeLineBindCode,
  selectLineWebhookBindCandidate,
  extractLineWebhookTextEvents,
} from "@/lib/line/line-bind";
import { evaluateLineWebhookEventClaim } from "@/lib/line/line-webhook-limits";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

export const SHARED_CHANNEL_ID = "2009219238";
export type WebhookRoutingEnvironment = "preview" | "production";
export type SharedWebhookArchitecture = "A_neutral_gateway" | "B_constrained_forward";

export type IsolatedChallenge = {
  id: string;
  environment: WebhookRoutingEnvironment;
  organizationId: string;
  staffUserId: string;
  channelId: string;
  codeHash: string;
  expiresAtMs: number;
  consumed: boolean;
};

export type IsolatedDatabase = {
  environment: WebhookRoutingEnvironment;
  available: boolean;
  challenges: IsolatedChallenge[];
  events: Set<string>;
  recipients: Array<{ organizationId: string; staffUserId: string; challengeId: string }>;
};

export type SharedChannelRouteResult = {
  ok: boolean;
  bound: boolean;
  reason:
    | "ok"
    | "unauthorized"
    | "invalid_input"
    | "duplicate"
    | "collision"
    | "unknown"
    | "unavailable"
    | "send_closed";
  environment?: WebhookRoutingEnvironment;
  organizationId?: string;
  staffUserId?: string;
  message: string;
};

const FAKE_LOCAL_SECRET = "local-prototype-channel-secret";

export function sharedWebhookRoutingFlagsClosed(): boolean {
  return (
    LINE_BROADCAST_SEND_OPEN === false &&
    LINE_AUTOMATION_SEND_OPEN === false &&
    LINE_OWNER_SELF_PUSH_OPEN === false &&
    LINE_AUTOMATION_KILL_SWITCH === false &&
    LINE_OWNER_SELF_GRANT_PERSIST_OPEN === false
  );
}

export function recommendedSharedWebhookArchitecture(): SharedWebhookArchitecture {
  return "B_constrained_forward";
}

export function createIsolatedDatabase(environment: WebhookRoutingEnvironment): IsolatedDatabase {
  return { environment, available: true, challenges: [], events: new Set(), recipients: [] };
}

export function issueIsolatedChallenge(input: {
  db: IsolatedDatabase;
  organizationId: string;
  staffUserId: string;
  code: string;
  nowMs?: number;
}): IsolatedChallenge | null {
  if (!challengeAllowedInDatabase(input.db.environment, input.organizationId)) return null;
  const code = normalizeLineBindCode(input.code);
  if (!code) return null;
  const row: IsolatedChallenge = {
    id: `lbc-local-${input.db.challenges.length + 1}`,
    environment: input.db.environment,
    organizationId: input.organizationId,
    staffUserId: input.staffUserId,
    channelId: SHARED_CHANNEL_ID,
    codeHash: hashLineBindCode(input.organizationId, code),
    expiresAtMs: (input.nowMs ?? Date.now()) + 10 * 60 * 1000,
    consumed: false,
  };
  input.db.challenges.push(row);
  return row;
}

export function challengeAllowedInDatabase(
  environment: WebhookRoutingEnvironment,
  organizationId: string,
): boolean {
  if (environment === "preview") return organizationId === ORG_BEAUTY_OS_TEST_ID;
  return organizationId === ORG_ENJOYE_ID;
}

export function signIsolatedWebhookBody(rawBody: string, secret = FAKE_LOCAL_SECRET): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

function verifyIsolatedSignature(rawBody: string, signature: string | null, secret: string): boolean {
  const provided = (signature ?? "").trim();
  if (!provided || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function openMatches(input: {
  db: IsolatedDatabase;
  code: string;
  nowMs: number;
}): IsolatedChallenge[] {
  if (!input.db.available) return [];
  return input.db.challenges.filter((row) => {
    if (row.consumed || row.expiresAtMs <= input.nowMs) return false;
    if (row.channelId !== SHARED_CHANNEL_ID) return false;
    if (!challengeAllowedInDatabase(input.db.environment, row.organizationId)) return false;
    return row.codeHash === hashLineBindCode(row.organizationId, input.code);
  });
}

export function routeSharedChannelWebhook(input: {
  rawBody: string;
  signature: string | null;
  urlOrganizationId?: string | null;
  preview: IsolatedDatabase;
  production: IsolatedDatabase;
  nowMs?: number;
  secret?: string;
}): SharedChannelRouteResult {
  if (!sharedWebhookRoutingFlagsClosed()) {
    return { ok: false, bound: false, reason: "send_closed", message: "發送開關被意外開啟，已拒絕" };
  }
  if (!verifyIsolatedSignature(input.rawBody, input.signature, input.secret ?? FAKE_LOCAL_SECRET)) {
    return { ok: false, bound: false, reason: "unauthorized", message: "LINE 簽章驗證失敗" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody) as unknown;
  } catch {
    return { ok: false, bound: false, reason: "invalid_input", message: "Webhook 內容無法解析" };
  }
  const events = extractLineWebhookTextEvents(payload);
  const candidate = selectLineWebhookBindCandidate(events);
  const candidateEvent = events.find((event) => {
    const selected = selectLineWebhookBindCandidate([event]);
    return Boolean(selected);
  });
  if (!candidate || !candidateEvent) {
    return { ok: true, bound: false, reason: "unknown", message: "未知事件，不消耗驗證碼" };
  }
  if (!input.preview.available || !input.production.available) {
    return { ok: false, bound: false, reason: "unavailable", message: "資料庫不可用，已 fail closed" };
  }
  const eventId = candidateEvent.eventId?.trim() ?? "";
  const channelEventKey = `${SHARED_CHANNEL_ID}:${eventId}`;
  const seen = new Set([...input.preview.events, ...input.production.events]);
  if (
    eventId &&
    (seen.has(channelEventKey) ||
      !evaluateLineWebhookEventClaim({ seenEventIds: seen, eventId: channelEventKey }).accept)
  ) {
    return { ok: true, bound: false, reason: "duplicate", message: "重複 webhookEventId，不消耗驗證碼" };
  }

  const nowMs = input.nowMs ?? Date.now();
  const previewHits = openMatches({ db: input.preview, code: candidate.code, nowMs });
  const productionHits = openMatches({ db: input.production, code: candidate.code, nowMs });
  const hits = [...previewHits, ...productionHits];
  if (hits.length === 0) {
    return { ok: true, bound: false, reason: "unknown", message: "沒有可消耗的可信驗證碼" };
  }
  if (hits.length > 1) {
    return { ok: false, bound: false, reason: "collision", message: "相同驗證碼跨組織碰撞，已全部拒絕" };
  }
  const chosen = hits[0];
  void input.urlOrganizationId;
  if (chosen.environment === "preview" && !input.preview.available) {
    return { ok: false, bound: false, reason: "unavailable", message: "Preview 資料庫不可用，已 fail closed" };
  }
  if (chosen.environment === "production" && !input.production.available) {
    return { ok: false, bound: false, reason: "unavailable", message: "Production 資料庫不可用，已 fail closed" };
  }
  const db = chosen.environment === "preview" ? input.preview : input.production;
  if (eventId) db.events.add(channelEventKey);
  chosen.consumed = true;
  db.recipients.push({
    organizationId: chosen.organizationId,
    staffUserId: chosen.staffUserId,
    challengeId: chosen.id,
  });
  return {
    ok: true,
    bound: true,
    reason: "ok",
    environment: chosen.environment,
    organizationId: chosen.organizationId,
    staffUserId: chosen.staffUserId,
    message: "已依 challenge 歸屬消耗驗證碼",
  };
}

export function compareSharedWebhookArchitectures(): {
  recommended: SharedWebhookArchitecture;
  keepTestBind: boolean;
  summary: string;
} {
  return {
    recommended: "B_constrained_forward",
    keepTestBind: true,
    summary:
      "Preview 與 Production 資料庫分離時，中立 Gateway 不能任意跨庫查詢；受限轉送可讓 Preview 只處理 TEST，Production 只重驗簽章後處理 Enjoye。",
  };
}
