export const LINE_AUTOMATION_PAGE_TITLE = "LINE自動推播設定";
export const LINE_AUTOMATION_PAGE_SUBTITLE =
  "設定自動發送規則，讓系統在適當時機主動關心您的客人，提升回訪與滿意度";

export const LINE_AUTOMATION_NOT_LIVE_HINT =
  "自動推播尚未正式啟用，不會發送 LINE 訊息。";
export const LINE_AUTOMATION_LOCAL_DRAFT_HINT =
  "開關與規則僅本機預覽，不會寫入資料庫，也不會建立排程。";
export const LINE_AUTOMATION_STATS_EMPTY_HINT =
  "尚無發送資料。自動推播尚未接上正式發送，此處不顯示模擬數字。";
export const LINE_AUTOMATION_HISTORY_EMPTY =
  "尚無發送紀錄。自動推播尚未接上正式發送。";
export const LINE_AUTOMATION_LOCAL_ONLY_BADGE = "尚未啟用";
export const LINE_AUTOMATION_LOCAL_PREVIEW_BADGE = "本機預覽中";
export const LINE_AUTOMATION_EMPTY_STAT = "—";
export const LINE_AUTOMATION_EMPTY_STAT_CAPTION = "尚無資料";
export const LINE_AUTOMATION_SETTINGS_LABEL = "設定規則";
export const LINE_AUTOMATION_APPLY_LOCAL_LABEL = "套用本機預覽";
export const LINE_AUTOMATION_EDITOR_WARNING =
  "此設定僅存在於此瀏覽器工作階段，不會寫入資料庫，也不會呼叫 LINE API。";
export const LINE_AUTOMATION_REMINDER_DEV_TITLE = "預約提醒開發狀態";
export const LINE_AUTOMATION_REMINDER_DEV_HINT =
  "預約提醒仍在開發。正式寫入、正式發送與測試授權都關閉。";
export const LINE_AUTOMATION_REMINDER_EDITOR_WARNING =
  "預約提醒仍在開發。此設定只本機預覽，不會寫入資料庫，也不會呼叫 LINE API。";
export const LINE_AUTOMATION_FLAG_CLOSED = "關閉";
export const LINE_AUTOMATION_FLAG_SEND_LABEL = "SEND";
export const LINE_AUTOMATION_FLAG_OWNER_SELF_LABEL = "OWNER_SELF_PUSH";
export const LINE_AUTOMATION_FLAG_KILL_LABEL = "KILL_SWITCH";
export const LINE_AUTOMATION_WRITE_CLOSED_LABEL = "正式寫入";
export const LINE_OWNER_SELF_TITLE = "店長本人預約提醒測試";
export const LINE_OWNER_SELF_HINT =
  "此區塊只顯示正式網站 THE ENJOYE 店長本人授權規劃。不會寫入測試授權，也不會連接 LINE Push。";
export const LINE_OWNER_SELF_CLOSED_LABEL = "正式發送、授權寫入與店長本人測試都關閉";
export const LINE_OWNER_SELF_ONCE_ONLY_LABEL = "只限一次的預約提醒測試，不是全店自動提醒";
export const LINE_OWNER_SELF_FLOW_HINT =
  "正式規劃：查看本人 LINE 綁定 → 獨立同意接收一則測試 → 建立一次性授權 → 可撤回同意 → 查看發送是否開放。此站全部停用，不會執行授權或發送。";
export const LINE_OWNER_SELF_DISABLED_HINT =
  "正式環境已停用授權、oneshot 與發送操作。不可假裝已經可以發送。";
export const LINE_OWNER_SELF_SEND_OPEN_LABEL = "發送是否開放";
export const LINE_OWNER_SELF_GRANT_LABEL = "建立一次性測試授權";
export const LINE_OWNER_SELF_REVOKE_LABEL = "撤回同意";
export const LINE_OWNER_SELF_ISSUE_LABEL = "確認並發行單次授權";
export const LINE_OWNER_SELF_CHECK_LABEL = "檢查店長本人發送（不會連接 LINE）";
export const LINE_OWNER_SELF_ACK_LABEL =
  "我了解這次只會發給我自己一則測試，不是開啟全店自動提醒";
export const LINE_OWNER_SELF_ACK_NOTE =
  "勾選只是畫面提示。正式環境不會建立授權列，前端勾選不能代替伺服器授權。";
export const LINE_OWNER_SELF_BIND_LABEL = "既有店長 Webhook 綁定";
export const LINE_OWNER_SELF_CONSENT_LABEL = "這次預約提醒測試的獨立同意";
export const LINE_OWNER_SELF_TRUST_LABEL = "可信店長本人收件者";
export const LINE_OWNER_SELF_MATCH_LABEL = "目前登入是否為綁定本人";
export const LINE_OWNER_SELF_PURPOSE_LABEL = "這次同意的目的";
export const LINE_OWNER_SELF_GRANT_TTL_LABEL = "授權有效期限";
export const LINE_OWNER_SELF_ONESHOT_TTL_LABEL = "單次授權有效期限";
export const LINE_OWNER_SELF_WEBHOOK_LABEL = "官方 Webhook 驗證";
export const LINE_OWNER_SELF_UNAVAILABLE = "正式環境未載入";
export const LINE_OWNER_SELF_PHRASE_LABEL = "二次確認文句";
export const LINE_OWNER_SELF_ONESHOT_LABEL = "單次授權";
export const LINE_OWNER_SELF_REMAINING_LABEL = "今日剩餘測試額度";
