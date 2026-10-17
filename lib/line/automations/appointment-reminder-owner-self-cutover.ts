/**
 * Phase 2F-3 official webhook cutover planning.
 * Pure decisions only. Does not change LINE Developers, deploy, or send.
 */
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

export const OFFICIAL_SITE_ORIGIN = "https://the-enjoye-website.vercel.app";
export const PREVIEW_WEBHOOK_ALIAS_ORIGIN =
  "https://the-enjoye-line-webhook-preview-pig85083189-6631s-projects.vercel.app";
export const SHARED_LINE_CHANNEL_ID = "2009219238";

export type WebhookCutoverBlocker =
  | "preview_alias_commit_unknown"
  | "developers_path_org_unknown"
  | "production_token_unknown"
  | "single_channel_single_url"
  | "preview_and_production_are_different_databases"
  | "enjoye_bind_ui_gated_to_test"
  | "production_credential_key_unknown"
  | "dedup_state_not_portable";

export type WebhookEventClass =
  | "user_text_bind_code"
  | "signed_empty_or_other"
  | "unsigned_or_bad_signature"
  | "admission_rejected";

export function webhookCutoverFlagsClosed(): boolean {
  return (
    LINE_BROADCAST_SEND_OPEN === false &&
    LINE_AUTOMATION_SEND_OPEN === false &&
    LINE_OWNER_SELF_PUSH_OPEN === false &&
    LINE_AUTOMATION_KILL_SWITCH === false &&
    LINE_OWNER_SELF_GRANT_PERSIST_OPEN === false
  );
}

export function classifyWebhookPathOrganization(pathname?: string | null): {
  organizationId: string | null;
  known: "enjoye" | "test" | "other" | "unknown";
} {
  const path = (pathname ?? "").split("?")[0];
  const match = path.match(/^\/api\/line\/webhook\/(org-[^/]+)\/[^/]+$/);
  if (!match) return { organizationId: null, known: "unknown" };
  const organizationId = match[1];
  if (organizationId === ORG_ENJOYE_ID) return { organizationId, known: "enjoye" };
  if (organizationId === ORG_BEAUTY_OS_TEST_ID) return { organizationId, known: "test" };
  return { organizationId, known: "other" };
}

export function officialWebhookTargetUrl(organizationId: string): string {
  return `${OFFICIAL_SITE_ORIGIN}/api/line/webhook/${organizationId}/{publicToken}`;
}

export function previewWebhookTargetUrl(organizationId: string): string {
  return `${PREVIEW_WEBHOOK_ALIAS_ORIGIN}/api/line/webhook/${organizationId}/{publicToken}`;
}

export function currentPhase2F3Blockers(): WebhookCutoverBlocker[] {
  return [
    "preview_alias_commit_unknown",
    "developers_path_org_unknown",
    "production_token_unknown",
    "single_channel_single_url",
    "preview_and_production_are_different_databases",
    "enjoye_bind_ui_gated_to_test",
    "production_credential_key_unknown",
    "dedup_state_not_portable",
  ];
}

export function canRecommendOfficialWebhookSwitch(input?: {
  blockers?: readonly WebhookCutoverBlocker[];
  ownerApprovedSwitch?: boolean;
}): boolean {
  if (input?.ownerApprovedSwitch !== true) return false;
  return (input.blockers ?? currentPhase2F3Blockers()).length === 0;
}

export function testWebhookBindAfterSwitch(input: {
  developersPathOrg: "enjoye" | "test" | "other" | "unknown";
}): { remainsUsable: boolean; blocker: boolean; message: string } {
  if (input.developersPathOrg === "unknown") {
    return {
      remainsUsable: false,
      blocker: true,
      message: "未確認 Developers 路徑店家時，不能假設 TEST 綁定仍可用",
    };
  }
  if (input.developersPathOrg === "enjoye") {
    return {
      remainsUsable: false,
      blocker: true,
      message: "同一 Channel 只能有一個 Webhook URL；改到正式 Enjoye 路徑後，TEST 驗證碼綁定不再被 consume",
    };
  }
  return {
    remainsUsable: false,
    blocker: true,
    message: "若 URL 仍是 TEST 路徑，正式 Enjoye 綁定不會成立；TEST 事件也會打到 Production 資料庫而找不到 Preview challenge",
  };
}

export function broadcastImpactOfWebhookSwitch(): {
  sendPathChanges: boolean;
  message: string;
} {
  return {
    sendPathChanges: false,
    message: "Broadcast 走 Channel Access Token HTTP，不走 Webhook。切換 URL 本身不改發送程式，SEND 仍關閉。",
  };
}

export function cutoverChecklist(): string[] {
  return [
    "Owner 只回報 Developers Webhook 路徑的店家段（org-the-enjoye 或 org-beauty-os-test），不要貼 public token。",
    "確認 Preview 別名實際部署 Commit / 環境（目前 UNKNOWN）。",
    "確認 Production 已有同一店家的 public token、Channel Secret 密文、BEAUTY_OS_LINE_CREDENTIAL_KEY 可解密。",
    "確認正式網站 POST webhook 仍是簽章失敗 403、缺 token 404，而不是 503。",
    "先讓 Enjoye Owner 能在正式網站查看 webhook URL 與產生驗證碼；現在這面只給 TEST。",
    "接受 TEST webhook 綁定在切換後會停用，且不可把 Preview 身分複製到 Production。",
    "準備好舊 Preview 完整 URL 的遮罩紀錄，供回復。",
    "SEND / OWNER_SELF_PUSH / KILL_SWITCH / Broadcast send 維持關閉。",
  ];
}

export function rollbackSteps(): string[] {
  return [
    "LINE Developers 把 Webhook URL 改回舊 Preview 別名與原路徑。不要輪替 Channel Token / Secret。",
    "按 Verify。成功後新事件回到 Preview Supabase。",
    "Production 在切換窗期間寫入的 webhook_events 不會回到 Preview；不要複製列。",
    "若切換窗有未完成的 Enjoye 驗證碼，回 Preview 後需重產，不要重放舊碼。",
    "漏接事件無法從 LINE 補抓。只重做店長驗證碼綁定，不補發 Push / Broadcast。",
  ];
}

export function ownerNextApprovals(): string[] {
  return [
    "回報 Developers Webhook 路徑店家段（不要貼 token）。",
    "核准是否接受 TEST webhook 綁定暫停。",
    "核准下一階段：正式網站 Enjoye 綁定啟動面（仍不改 Developers URL）。",
    "在以上完成前，不要核准把 Webhook 改成 Production URL。",
  ];
}
