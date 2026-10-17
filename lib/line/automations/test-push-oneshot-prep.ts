/**
 * Phase 3C-1 one-shot TEST LINE push preparation.
 * Reuses existing env, quota, claim pipeline, and push adapter.
 * Does not open SEND, call a live LINE API, or apply remote SQL.
 */
import { lineUserIdHint } from "@/lib/line/line-bind";
import {
  LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID,
  LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
  LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
  LINE_BROADCAST_ONESHOT_CHANNEL_ID,
  LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST,
  LINE_BROADCAST_SEND_OPEN,
  LINE_TEST_PUSH_OPEN,
  isLineBroadcastOneshotEnvironmentOpen,
} from "@/lib/line/line-flag";
import { describeLineQuota, lineOfficialQuotaBlockMessage, lineQuotaBlocksSend } from "@/lib/line/line-quota";
import type { LineQuotaPublic } from "@/lib/line/line-types";
import { lineAutomationById } from "@/lib/line/automations/catalog";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
export const TEST_PUSH_PREP_CHANNEL_ID = LINE_BROADCAST_ONESHOT_CHANNEL_ID;
export const TEST_PUSH_PREP_ORG_ID = LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID;
export const TEST_PUSH_PREVIEW_TEXT = lineAutomationById("appointment_reminder").demoTemplate;
export const TEST_PUSH_RECIPIENT_UNKNOWN_HINT = "••••";
export const TEST_PUSH_PREVIEW_ENV: NodeJS.Dict<string> = {
  VERCEL_ENV: "preview",
  NEXT_PUBLIC_SUPABASE_URL: `https://${LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST}`,
};

export const TEST_PUSH_GATE_IDS = [
  "test_environment_and_channel",
  "explicit_test_recipient",
  "webhook_code_bind",
  "not_blocked_or_revoked",
  "message_previewable",
  "oneshot_grant_unused",
  "quota_confirmed",
  "rate_and_audit",
] as const;

export type TestPushGateId = (typeof TEST_PUSH_GATE_IDS)[number];
export type TestPushAttemptStatus =
  | "blocked"
  | "claimed"
  | "accepted"
  | "failed"
  | "pending_confirmation";

export type TestPushGate = {
  id: TestPushGateId;
  ok: boolean;
  message: string;
};

export type TestPushRecipientSnapshot = {
  readable: boolean;
  hint?: string | null;
  bindMethod?: string | null;
  approved?: boolean;
  blocked?: boolean | null;
  revoked?: boolean | null;
  ownerIdentityConfirmed?: boolean | null;
  rawUserId?: string | null;
};

export type TestPushGrant = {
  id: string;
  organizationId: string;
  channelId: string;
  recipientHint: string;
  expiresAtMs: number;
  consumed: boolean;
  revoked: boolean;
};

export type TestPushClaimRow = {
  claimKey: string;
  grantId: string;
  requestId: string;
  organizationId: string;
  channelId: string;
  recipientHint: string;
  status: TestPushAttemptStatus;
};

export type TestPushStore = {
  grants: TestPushGrant[];
  claims: TestPushClaimRow[];
  events: Array<{
    requestId: string;
    grantId: string;
    claimKey: string;
    status: TestPushAttemptStatus;
    reason: string;
    sentLine: false;
  }>;
};

export const REMOTE_ATOMIC_CLAIM_REQUIRED = true;

export function serializeTestPushClaimKey(input: {
  organizationId: string;
  channelId: string;
  grantId: string;
  requestId: string;
  recipientHint: string;
}): string {
  return [
    input.organizationId.trim(),
    input.channelId.trim(),
    input.grantId.trim(),
    input.requestId.trim(),
    input.recipientHint.trim(),
  ].join("|");
}

export function testPushPrepFlagsClosed(): boolean {
  return (
    LINE_BROADCAST_SEND_OPEN === false &&
    LINE_TEST_PUSH_OPEN === false &&
    LINE_AUTOMATION_SEND_OPEN === false &&
    LINE_OWNER_SELF_PUSH_OPEN === false &&
    LINE_AUTOMATION_KILL_SWITCH === false
  );
}

export function canEnableTestPushSendButton(): boolean {
  return false;
}

export function maskTestPushChannelId(channelId = TEST_PUSH_PREP_CHANNEL_ID): string {
  const id = channelId.trim();
  if (id.length <= 4) return "••••";
  return `••••${id.slice(-4)}`;
}

export function maskTestPushRecipient(input: TestPushRecipientSnapshot): string {
  if (input.rawUserId) return lineUserIdHint(input.rawUserId);
  const hint = (input.hint ?? "").trim();
  if (hint.startsWith("••••")) return hint;
  return TEST_PUSH_RECIPIENT_UNKNOWN_HINT;
}

export function currentTestPushRecipientStatus(): {
  status: "unknown";
  hint: string;
  bindMethod: null;
  valid: null;
  ownerIdentityConfirmed: null;
  blocked: "unknown";
  revoked: "unknown";
} {
  return {
    status: "unknown",
    hint: TEST_PUSH_RECIPIENT_UNKNOWN_HINT,
    bindMethod: null,
    valid: null,
    ownerIdentityConfirmed: null,
    blocked: "unknown",
    revoked: "unknown",
  };
}

export function recommendedTestPushEnvironment(): {
  executeOn: "preview";
  officialSiteRole: "ui_only";
  copyPreviewBindToProduction: false;
  reason: string;
} {
  return {
    executeOn: "preview",
    officialSiteRole: "ui_only",
    copyPreviewBindToProduction: false,
    reason:
      "測試 Channel Webhook 與 webhook_code 綁定都在 Preview TEST。正式網站只可看 UI，不可讀 Preview recipient 或跨庫寫入。",
  };
}

export function ownerPreviewTestStepsWithoutSecrets(): string[] {
  return [
    "用 Beauty OS TEST 店長登入 Preview 後台，不要貼 Channel Secret 或 Access Token。",
    "只回報綁定 hint 後四碼與 Channel 後四碼，確認是 webhook_code。",
    "正式網站只查看檢查結果，不要在正式網站執行發送。",
    "憑證只走 Preview 既有加密讀取，不複製到 Production，也不貼到聊天。",
  ];
}

export function evaluateTestPushGates(input: {
  env?: NodeJS.Dict<string>;
  organizationId?: string | null;
  channelId?: string | null;
  botDisplayName?: string | null;
  botBasicId?: string | null;
  recipient?: TestPushRecipientSnapshot;
  textBody?: string | null;
  grant?: TestPushGrant | null;
  quota?: LineQuotaPublic | null;
  nowMs?: number;
}): { ok: boolean; sendOpen: false; gates: TestPushGate[] } {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const recipient = input.recipient ?? { readable: false };
  const nowMs = input.nowMs ?? Date.now();
  const gates: TestPushGate[] = [
    {
      id: "test_environment_and_channel",
      ok:
        isLineBroadcastOneshotEnvironmentOpen(env) &&
        (input.organizationId ?? "").trim() === TEST_PUSH_PREP_ORG_ID &&
        (input.channelId ?? "").trim() === TEST_PUSH_PREP_CHANNEL_ID &&
        (input.botDisplayName ?? "").trim() === LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME &&
        (input.botBasicId ?? "").trim() === LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
      message: "必須是 Preview TEST 與 Channel 2009219238",
    },
    {
      id: "explicit_test_recipient",
      ok:
        recipient.readable === true &&
        recipient.approved === true &&
        recipient.ownerIdentityConfirmed === true,
      message: "必須是明確同意的測試接收者，且能確認是店長本人",
    },
    {
      id: "webhook_code_bind",
      ok: recipient.readable === true && recipient.bindMethod === "webhook_code" && Boolean(recipient.hint?.startsWith("••••")),
      message: "必須經 webhook_code 確認，畫面只顯示遮罩",
    },
    {
      id: "not_blocked_or_revoked",
      ok: recipient.readable === true && recipient.blocked === false && recipient.revoked === false,
      message: "接收者封鎖與撤銷狀態必須明確為否；未知不得通過",
    },
    {
      id: "message_previewable",
      ok: (input.textBody ?? TEST_PUSH_PREVIEW_TEXT).trim().length > 0,
      message: "發送前必須可預覽訊息全文",
    },
    {
      id: "oneshot_grant_unused",
      ok: Boolean(
        input.grant &&
          !input.grant.consumed &&
          !input.grant.revoked &&
          input.grant.expiresAtMs > nowMs &&
          input.grant.organizationId === TEST_PUSH_PREP_ORG_ID,
      ),
      message: "單次授權只能使用一次，且不得過期",
    },
    {
      id: "quota_confirmed",
      ok: !lineQuotaBlocksSend(input.quota ?? null),
      message: input.quota ? lineOfficialQuotaBlockMessage(input.quota) : "LINE 額度尚未確認",
    },
    {
      id: "rate_and_audit",
      ok: testPushPrepFlagsClosed() && LINE_BROADCAST_SEND_OPEN === false,
      message: "頻率與事件紀錄沿用既有 lock；本階段發送開關維持關閉",
    },
  ];
  return { ok: gates.every((row) => row.ok), sendOpen: false, gates };
}

export function createTestPushStore(): TestPushStore {
  return {
    grants: [],
    claims: [],
    events: [],
  };
}

export function issueLocalTestPushGrant(
  store: TestPushStore,
  nowMs = Date.now(),
  over: Partial<TestPushGrant> = {},
): TestPushGrant {
  const grant: TestPushGrant = {
    id: over.id ?? `lpg-3c2-${store.grants.length + 1}`,
    organizationId: over.organizationId ?? TEST_PUSH_PREP_ORG_ID,
    channelId: over.channelId ?? TEST_PUSH_PREP_CHANNEL_ID,
    recipientHint: over.recipientHint ?? "••••ab12",
    expiresAtMs: over.expiresAtMs ?? nowMs + 10 * 60 * 1000,
    consumed: over.consumed ?? false,
    revoked: over.revoked ?? false,
  };
  store.grants.push(grant);
  return grant;
}

export function claimPersistentTestPushGrant(
  store: TestPushStore,
  input: {
    grantId: string;
    requestId: string;
    organizationId: string;
    channelId: string;
    recipientHint: string;
    nowMs: number;
  },
):
  | { ok: true; broadcastId: string; requestId: string; claimKey: string }
  | { ok: false; reason: "duplicate" | "send_closed"; message: string } {
  const organizationId = input.organizationId.trim();
  const channelId = input.channelId.trim();
  const recipientHint = input.recipientHint.trim();
  const requestId = input.requestId.trim();
  const grant = store.grants.find((row) => row.id === input.grantId);
  if (!grant || grant.revoked) {
    return { ok: false, reason: "send_closed", message: "測試授權已撤銷" };
  }
  if (grant.expiresAtMs <= input.nowMs) {
    return { ok: false, reason: "send_closed", message: "測試授權已過期" };
  }
  if (grant.organizationId !== organizationId || organizationId !== TEST_PUSH_PREP_ORG_ID) {
    return { ok: false, reason: "send_closed", message: "跨店授權不可使用" };
  }
  if (grant.channelId !== channelId || channelId !== TEST_PUSH_PREP_CHANNEL_ID) {
    return { ok: false, reason: "send_closed", message: "Channel 與單次授權不一致" };
  }
  if (grant.recipientHint !== recipientHint || !recipientHint.startsWith("••••")) {
    return { ok: false, reason: "send_closed", message: "接收者與單次授權不一致" };
  }
  const claimKey = serializeTestPushClaimKey({
    organizationId,
    channelId,
    grantId: grant.id,
    requestId,
    recipientHint,
  });
  const replay =
    store.claims.some((row) => row.requestId === requestId) ||
    store.claims.some((row) => row.grantId === grant.id) ||
    store.events.some((row) => row.requestId === requestId);
  if (replay || grant.consumed) {
    return { ok: false, reason: "duplicate", message: "同一請求不可重複送出" };
  }
  grant.consumed = true;
  store.claims.push({
    claimKey,
    grantId: grant.id,
    requestId,
    organizationId,
    channelId,
    recipientHint,
    status: "claimed",
  });
  return { ok: true, broadcastId: `lts-${grant.id}`, requestId, claimKey };
}

export function passingTestPushSnapshot(nowMs = Date.now()): Parameters<typeof evaluateTestPushGates>[0] {
  return {
    env: TEST_PUSH_PREVIEW_ENV,
    organizationId: TEST_PUSH_PREP_ORG_ID,
    channelId: TEST_PUSH_PREP_CHANNEL_ID,
    botDisplayName: LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
    botBasicId: LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
    recipient: {
      readable: true,
      hint: "••••ab12",
      bindMethod: "webhook_code",
      approved: true,
      blocked: false,
      revoked: false,
      ownerIdentityConfirmed: true,
    },
    textBody: TEST_PUSH_PREVIEW_TEXT,
    grant: {
      id: "lpg-3c2-fixture",
      organizationId: TEST_PUSH_PREP_ORG_ID,
      channelId: TEST_PUSH_PREP_CHANNEL_ID,
      recipientHint: "••••ab12",
      expiresAtMs: nowMs + 60_000,
      consumed: false,
      revoked: false,
    },
    quota: describeLineQuota({ type: "none", usage: 0 }),
    nowMs,
  };
}
