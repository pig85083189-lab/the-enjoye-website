/**
 * Phase 2F-7 official vs Preview TEST LINE Channel split (planning only).
 * Does not create accounts, change Developers URLs, rotate secrets, or send.
 */
import {
  ENJOYE_OWNER_BIND_ISSUE_OPEN,
  ENJOYE_OWNER_BIND_WEBHOOK_READY,
} from "@/lib/line/enjoye-owner-bind-prep";
import { LINE_BROADCAST_CHANNEL_LOCK_NAMESPACE } from "@/lib/line/line-channel-lock";
import {
  LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
  LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
  LINE_BROADCAST_ONESHOT_CHANNEL_ID,
  LINE_BROADCAST_SEND_OPEN,
} from "@/lib/line/line-flag";
import { lineBroadcastSharedChannelOwner } from "@/lib/line/line-formal";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

export const OFFICIAL_LINE_CHANNEL_ID = "2009219238";
export const OFFICIAL_LINE_BOT_DISPLAY_NAME = "ai";
export const OFFICIAL_LINE_BOT_BASIC_ID = "@357gospk";
export const PREVIEW_TEST_CHANNEL_ID: string | null = null;

export type ChannelSplitPhase =
  | "prepare_test_channel_checklist"
  | "owner_creates_test_oa"
  | "preview_test_uses_new_channel"
  | "confirm_test_independent"
  | "discuss_official_webhook_to_production";

export type ChannelSplitOwnerStep = {
  id: string;
  title: string;
  screens: string[];
};

export function phase2F7FlagsClosed(): boolean {
  return (
    LINE_BROADCAST_SEND_OPEN === false &&
    LINE_AUTOMATION_SEND_OPEN === false &&
    LINE_OWNER_SELF_PUSH_OPEN === false &&
    LINE_AUTOMATION_KILL_SWITCH === false &&
    LINE_OWNER_SELF_GRANT_PERSIST_OPEN === false &&
    ENJOYE_OWNER_BIND_WEBHOOK_READY === false &&
    ENJOYE_OWNER_BIND_ISSUE_OPEN === false
  );
}

export function currentChannelSplitPhase(): ChannelSplitPhase {
  return "prepare_test_channel_checklist";
}

export function officialChannelRetention(): {
  channelId: string;
  botDisplayName: string;
  botBasicId: string;
  formalOwnerOrganizationId: string;
  lockNamespace: number;
  keepFriends: true;
  keepBroadcastProgram: true;
} {
  return {
    channelId: OFFICIAL_LINE_CHANNEL_ID,
    botDisplayName: OFFICIAL_LINE_BOT_DISPLAY_NAME,
    botBasicId: OFFICIAL_LINE_BOT_BASIC_ID,
    formalOwnerOrganizationId: ORG_ENJOYE_ID,
    lockNamespace: LINE_BROADCAST_CHANNEL_LOCK_NAMESPACE,
    keepFriends: true,
    keepBroadcastProgram: true,
  };
}

export function previewTestOfficialChannelCouplings(): string[] {
  return [
    "LINE_BROADCAST_ONESHOT_CHANNEL_ID=2009219238",
    "LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME=ai",
    "LINE_BROADCAST_ONESHOT_BOT_BASIC_ID=@357gospk",
    "oneshot SQL channel_id / bot identity checks",
    "shared Channel lock namespace 870121",
    "official Developers Webhook still on Preview TEST path",
    "Preview TEST webhook signature uses official Channel Secret",
  ];
}

export function officialChannelStillSharedWithTest(): boolean {
  return (
    LINE_BROADCAST_ONESHOT_CHANNEL_ID === OFFICIAL_LINE_CHANNEL_ID &&
    LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME === OFFICIAL_LINE_BOT_DISPLAY_NAME &&
    LINE_BROADCAST_ONESHOT_BOT_BASIC_ID === OFFICIAL_LINE_BOT_BASIC_ID &&
    lineBroadcastSharedChannelOwner(OFFICIAL_LINE_CHANNEL_ID) === ORG_ENJOYE_ID &&
    PREVIEW_TEST_CHANNEL_ID === null
  );
}

export function ownerCreateTestChannelSteps(): ChannelSplitOwnerStep[] {
  return [
    {
      id: "create_test_oa",
      title: "建立獨立測試用 LINE 官方帳號",
      screens: [
        "打開 https://manager.line.biz ，使用可管理官方帳號的 LINE 登入。",
        "按「建立」→「建立官方帳號」。不要打開既有「ai / THE ENJOYE」帳號的設定。",
        "國家／地區選台灣。帳號名稱請用測試名（例如 Beauty OS TEST），不要用正式店名誤導客人。",
        "產業可選與正式店相近。搜尋／公開設定先關閉，避免客人加到測試帳號。",
        "建立完成後只記帳號名稱，不要把正式好友或 LINE userId 複製過來。",
      ],
    },
    {
      id: "enable_messaging_api",
      title: "為測試帳號啟用 Messaging API",
      screens: [
        "在 LINE Official Account Manager 打開剛建立的測試帳號。",
        "左側「設定」→「Messaging API」→「啟用 Messaging API」。",
        "依畫面同意後，系統會在 LINE Developers 建立對應 Channel。",
        "不要對 Channel 2009219238 按啟用、停用或任何更新。",
      ],
    },
    {
      id: "read_test_channel_id",
      title: "取得新的測試 Channel ID",
      screens: [
        "打開 https://developers.line.biz/console/ 。",
        "在 Provider 下找剛啟用的測試 Channel，確認 Channel ID 不是 2009219238。",
        "只把測試 Channel ID 後四碼回報給後續階段，不要貼完整 Secret 或 Token。",
      ],
    },
    {
      id: "plan_preview_webhook",
      title: "設定 Preview 專用 Webhook（核准後才做）",
      screens: [
        "只在新的測試 Channel → Messaging API → Webhook URL 填 Preview TEST 路徑。",
        "路徑形狀：/api/line/webhook/org-beauty-os-test/{publicToken}。不要貼 token 到聊天。",
        "開啟 Use webhook 後按 Verify。失敗就停，不要改正式 Channel。",
        "回應設定：關閉自動回應與歡迎訊息，避免測試驗證碼被自動回覆蓋掉。",
      ],
    },
    {
      id: "plan_test_secrets",
      title: "確認 Preview 專用 Channel Secret / Access Token",
      screens: [
        "在測試 Channel 基本設定查看 Channel secret。",
        "在 Messaging API 發行長期 Channel access token（只給 Preview）。",
        "正式 Channel 的 Secret / Token 不要輪替、不要複製到 Preview，也不要貼到聊天。",
        "本階段只確認畫面看得到，不寫入遠端、不部署。",
      ],
    },
    {
      id: "plan_test_bind_isolation",
      title: "測試驗證碼綁定與隔離（核准後才做）",
      screens: [
        "只用測試官方帳號加測試人員為好友。不要把正式客人加進來。",
        "在 Preview Beauty OS TEST 發 8 碼，從測試帳號對話送出。",
        "確認正式 Channel 2009219238 沒有收到這則驗證碼事件。",
        "確認正式 Broadcast、Channel lock、正式好友名單都沒有被改到。",
      ],
    },
  ];
}

export function previewTestSwitchChecklist(): string[] {
  return [
    "Owner 已建立測試官方帳號，且 Messaging API Channel ID ≠ 2009219238",
    "測試 Channel Webhook 指向 Preview + org-beauty-os-test，Verify 成功",
    "Preview line_official_accounts 改存測試 Channel，不再存 2009219238",
    "後續階段才改 LINE_BROADCAST_ONESHOT_* 與 oneshot SQL 身分檢查",
    "Channel lock 不再把 TEST 與 Enjoye 鎖在同一 Channel",
    "正式 Channel 2009219238 的 Developers Webhook 仍未改動",
    "SEND / OWNER_SELF_PUSH / 正式驗證碼發行全部維持關閉",
  ];
}

export function canDiscussOfficialWebhookMove(input: {
  testChannelId?: string | null;
  oneshotStillOfficial?: boolean;
  officialWebhookChanged?: boolean;
  testWebhookVerified?: boolean;
}): { ok: false; reason: string; message: string } {
  if (input.officialWebhookChanged === true) {
    return { ok: false, reason: "forbidden", message: "本階段禁止改正式 Channel Webhook" };
  }
  const testChannelId = (input.testChannelId ?? PREVIEW_TEST_CHANNEL_ID ?? "").trim();
  if (!testChannelId || testChannelId === OFFICIAL_LINE_CHANNEL_ID) {
    return { ok: false, reason: "test_channel_unassigned", message: "測試 Channel 尚未獨立，不能討論正式 Webhook 切換" };
  }
  if (input.testWebhookVerified !== true) {
    return { ok: false, reason: "test_webhook_unverified", message: "測試 Channel Webhook 尚未 Verify" };
  }
  if (input.oneshotStillOfficial !== false) {
    return { ok: false, reason: "oneshot_still_official", message: "Preview oneshot 仍引用正式 Channel" };
  }
  return { ok: false, reason: "not_this_phase", message: "正式 Webhook 切換需另一次 Owner 核准" };
}

export function officialWebhookLaterOrder(): string[] {
  return [
    "先完成 Preview TEST 獨立 Channel，且 oneshot / 測試綁定不再引用 2009219238",
    "唯讀確認 Production Enjoye public token 存在，不輪替、不複製",
    "唯讀確認 Production 加密金鑰對得上既有密文，不輪替、不列印",
    "正式網站以 THE ENJOYE 店長登入，核對 2F-4 畫面的 operational staff id",
    "另一次核准後，才把 Channel 2009219238 Webhook 改到正式網站 org-the-enjoye 路徑",
    "Verify 只做 LINE 官方空 events。SEND 與正式驗證碼發行仍關閉，直到再一次核准",
  ];
}

export function officialOwnerBindLaterChecklist(): string[] {
  return [
    "沿用 /staff/settings/line 的 2F-4 THE ENJOYE 店長綁定準備卡，不要另做啟動鈕",
    "ENJOYE_OWNER_BIND_WEBHOOK_READY 與 ISSUE 維持 false，直到正式 Webhook 已在 Production",
    "Production public token、加密金鑰、Owner staff id 都需唯讀確認",
    "測試 Channel 建立完成，不得打開正式綁定或任何 LINE 發送",
    "不可手寫已驗證、不可複製 Preview / 測試 LINE 身分到 Production",
  ];
}

export function channelSplitRollbackSteps(): string[] {
  return [
    "若測試帳號建立失敗：停用或捨棄測試 Channel，正式 Channel 2009219238 維持不動",
    "若誤改正式 Webhook：立刻改回舊 Preview 別名與原路徑，按 Verify，不輪替 Token / Secret",
    "不要把正式或測試的好友、驗證碼、webhook_events、recipients 互相複製",
    "回復後重新發驗證碼，不要重放舊碼，也不要用 Push / Broadcast 補事件",
  ];
}

export function remainingChannelSplitBlockers(): string[] {
  return [
    "測試 LINE 官方帳號與 Messaging API Channel 尚未建立",
    "PREVIEW_TEST_CHANNEL_ID 仍未指派",
    "Preview oneshot / SQL 仍硬編碼 2009219238、ai、@357gospk",
    "正式 Developers Webhook 仍在 Preview TEST 路徑（2F-3 確認）",
    "Production Enjoye public token / 加密金鑰 / Owner staff id 尚未唯讀確認",
    "正式驗證碼發行與 SEND 必須維持關閉",
  ];
}

export function nextOwnerApprovalActions(): string[] {
  return [
    "依清單建立獨立測試官方帳號並啟用 Messaging API（不要改 2009219238）",
    "只回報新測試 Channel ID 後四碼，確認不是 2009219238",
    "回報測試 Channel 尚未填 Webhook，或只填 Preview TEST 路徑且未改正式 Channel",
    "在上述完成並另一次核准前，不要把正式 Webhook 改到 Production，也不要開 SEND",
  ];
}
