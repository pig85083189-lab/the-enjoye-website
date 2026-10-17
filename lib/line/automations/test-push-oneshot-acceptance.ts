/**
 * Phase 3C-2 Preview TEST bind confirmation and one-shot safety acceptance.
 * Read-only. Does not query Preview, apply SQL, open SEND, or call LINE.
 */
import {
  LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST,
} from "@/lib/line/line-flag";
import {
  TEST_PUSH_PREP_CHANNEL_ID,
  TEST_PUSH_PREP_ORG_ID,
  TEST_PUSH_RECIPIENT_UNKNOWN_HINT,
  maskTestPushRecipient,
  type TestPushRecipientSnapshot,
} from "@/lib/line/automations/test-push-oneshot-prep";

export const PREVIEW_READONLY_QUERY_ALLOWED = false;
export const LOCAL_SET_IS_REMOTE_CLAIM = false;
export const FIRST_REAL_SEND_ALLOWED = false;

export type PreviewAccessVerdict = "unknown";
export type SchemaRemoteVerdict = "unknown";
export type TriState = "unknown" | "yes" | "no";

export type PreviewSchemaObject = {
  id: string;
  kind: "table" | "rpc" | "column" | "grant";
  localSource: "migration" | "none";
  localFile: string | null;
  remoteApplied: SchemaRemoteVerdict;
  notes: string;
};

export function probePreviewReadonlyAccess(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): {
  access: "none";
  recipientStatus: PreviewAccessVerdict;
  schemaStatus: SchemaRemoteVerdict;
  channelIdMasked: string;
  organizationId: typeof TEST_PUSH_PREP_ORG_ID;
  canConfirmOwnerIdentity: false;
  reason: string;
} {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const hasPreviewHost = url.includes(LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST);
  return {
    access: "none",
    recipientStatus: "unknown",
    schemaStatus: "unknown",
    channelIdMasked: "••••9238",
    organizationId: TEST_PUSH_PREP_ORG_ID,
    canConfirmOwnerIdentity: false,
    reason: hasPreviewHost
      ? "此執行階段即使看到 Preview hostname，也沒有核准的唯讀查詢權限，不可讀取綁定列。"
      : "此執行階段沒有 Preview 資料庫憑證，不能讀取綁定或遠端結構。",
  };
}

export function inspectPreviewRemoteSchema(): {
  verdict: SchemaRemoteVerdict;
  localDraftsExist: true;
  remoteConfirmed: false;
  objects: PreviewSchemaObject[];
} {
  return {
    verdict: "unknown",
    localDraftsExist: true,
    remoteConfirmed: false,
    objects: [
      {
        id: "line_owner_recipients",
        kind: "table",
        localSource: "migration",
        localFile: "supabase/migrations/20261010160000_line_owner_test_push.sql",
        remoteApplied: "unknown",
        notes: "本機草案有 webhook_code 綁定表與 hint 遮罩約束。遠端是否已套用未知。",
      },
      {
        id: "line_owner_recipient_secrets",
        kind: "table",
        localSource: "migration",
        localFile: "supabase/migrations/20261010160000_line_owner_test_push.sql",
        remoteApplied: "unknown",
        notes: "密文列。本階段不可讀取或複製。",
      },
      {
        id: "start_line_owner_bind_challenge",
        kind: "rpc",
        localSource: "migration",
        localFile: "supabase/migrations/20261010160000_line_owner_test_push.sql",
        remoteApplied: "unknown",
        notes: "店長綁定挑戰 RPC。本階段不執行。",
      },
      {
        id: "consume_line_owner_bind_challenge",
        kind: "rpc",
        localSource: "migration",
        localFile: "supabase/migrations/20261010160000_line_owner_test_push.sql",
        remoteApplied: "unknown",
        notes: "Webhook 消費綁定碼。本階段不執行。",
      },
      {
        id: "claim_line_test_send",
        kind: "rpc",
        localSource: "migration",
        localFile: "supabase/migrations/20261010190000_line_test_push_claim_daily_quota.sql",
        remoteApplied: "unknown",
        notes: "測試 Push 原子 claim + 當日額度。正式執行必須用此遠端 RPC，不可用本機 Set。",
      },
      {
        id: "complete_line_test_send",
        kind: "rpc",
        localSource: "migration",
        localFile: "supabase/migrations/20261010160000_line_owner_test_push.sql",
        remoteApplied: "unknown",
        notes: "寫入 accepted / failed / pending_confirmation。",
      },
      {
        id: "line_test_sends",
        kind: "table",
        localSource: "migration",
        localFile: "supabase/migrations/20261010160000_line_owner_test_push.sql",
        remoteApplied: "unknown",
        notes: "測試發送列與 requestId 唯一約束。遠端是否存在未知。",
      },
      {
        id: "line_official_accounts.test_push_runtime_open",
        kind: "column",
        localSource: "migration",
        localFile: "supabase/migrations/20261011010000_line_test_push_runtime_kill_switch.sql",
        remoteApplied: "unknown",
        notes: "測試發送 runtime 開關，草案預設關閉。",
      },
      {
        id: "line_broadcast_oneshot_permits",
        kind: "table",
        localSource: "migration",
        localFile: "supabase/migrations/20261011140000_line_broadcast_oneshot_permit.sql",
        remoteApplied: "unknown",
        notes: "這是群發 oneshot，鎖定群發測試全文。不可重用於預約提醒 Push。",
      },
      {
        id: "appointment_reminder_oneshot_grant",
        kind: "grant",
        localSource: "none",
        localFile: null,
        remoteApplied: "unknown",
        notes: "預約提醒單次授權遠端列尚未在本機草案建立。店長本人授權寫入旗標仍關閉。",
      },
    ],
  };
}

export function evaluateRecipientSafety(recipient?: TestPushRecipientSnapshot): {
  ok: boolean;
  hint: string;
  bindMethod: string | null;
  blocked: "unknown" | "blocked" | "not_blocked";
  revoked: "unknown" | "revoked" | "not_revoked";
  ownerIdentity: "unknown" | "confirmed" | "mismatch";
  verdict: "fail_closed";
} {
  const row = recipient ?? { readable: false };
  const blocked =
    row.blocked === true ? "blocked" : row.blocked === false ? "not_blocked" : "unknown";
  const revoked =
    row.revoked === true ? "revoked" : row.revoked === false ? "not_revoked" : "unknown";
  const ownerIdentity =
    row.ownerIdentityConfirmed === true
      ? "confirmed"
      : row.ownerIdentityConfirmed === false
        ? "mismatch"
        : "unknown";
  return {
    ok: false,
    hint: maskTestPushRecipient(row),
    bindMethod: row.bindMethod ?? null,
    blocked,
    revoked,
    ownerIdentity,
    verdict: "fail_closed",
  };
}

export function currentPreviewBindConfirmation(): {
  status: PreviewAccessVerdict;
  hint: string;
  bindMethod: null;
  valid: null;
  ownerIdentityConfirmed: false;
  blocked: "unknown";
  revoked: "unknown";
} {
  const probe = probePreviewReadonlyAccess();
  return {
    status: probe.recipientStatus,
    hint: TEST_PUSH_RECIPIENT_UNKNOWN_HINT,
    bindMethod: null,
    valid: null,
    ownerIdentityConfirmed: false,
    blocked: "unknown",
    revoked: "unknown",
  };
}

export function ownerPreviewBindConfirmationSteps(): string[] {
  return [
    "用 Beauty OS TEST 店長登入 Preview 後台，不要貼 Channel Secret、Access Token 或 LINE userId。",
    "確認目前店家是測試店，畫面只核對 Channel 後四碼是否為 9238。",
    "只回報綁定 hint 後四碼與綁定方式是否為 webhook_code，以及綁定是否仍有效、尚未解除。",
    "不要宣稱可判斷封鎖：目前 Webhook 不處理 unfollow 或封鎖事件。",
    "正式網站只可看檢查結果，不要在正式網站執行發送，也不要複製 Preview 綁定到正式庫。",
    "若要確認資料表或 RPC 是否已套用，需另開 Owner 核准的 Preview 唯讀檢查；本階段不套用 SQL。",
  ];
}

export function remainingFirstSendBlockers(): string[] {
  return [
    "Owner 在 Preview 後台唯讀確認測試綁定（只回報遮罩 hint 與 webhook_code）。",
    "Owner 核准 Preview 唯讀檢查，確認 recipients / claim RPC / 額度列已套用；本機 migration 不算遠端保證。",
    "正式執行必須使用遠端原子 claim，綁定 grant、requestId、接收者與測試 Channel；本機 store 不可當作保證。",
    "預約提醒單次授權不可重用群發 oneshot permit。",
    "Preview 部署含本階段安全碼之後，才可討論發送開關。",
    "Owner 個別核准測試發送開關與單則訊息。目前發送開關維持關閉。",
  ];
}

export function nextOwnerApprovedMinimumAction(): string {
  return "Owner 在 Preview 後台唯讀確認測試綁定：只回報遮罩 hint、webhook_code、是否仍有效。不要套用 SQL、不要部署、不要開發送。";
}

export function firstRealSendReady(): false {
  return FIRST_REAL_SEND_ALLOWED;
}
