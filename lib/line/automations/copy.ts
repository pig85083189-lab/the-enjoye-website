export const LINE_AUTOMATION_PAGE_TITLE = "LINE 自動通知";
export const LINE_AUTOMATION_PAGE_SUBTITLE = "輕鬆管理顧客通知與關懷";

export const LINE_AUTOMATION_NOT_LIVE_HINT =
  "自動通知尚未正式啟用，不會發送 LINE 訊息。";
export const LINE_AUTOMATION_LOCAL_DRAFT_HINT =
  "開關與規則僅本機預覽，不會寫入資料庫，也不會建立排程。";
export const LINE_AUTOMATION_STATS_EMPTY_HINT =
  "尚無發送資料。自動通知尚未接上正式發送，此處不顯示模擬數字。";
export const LINE_AUTOMATION_HISTORY_EMPTY =
  "尚無發送紀錄。自動通知尚未接上正式發送。";
export const LINE_AUTOMATION_HISTORY_SUBTITLE = "查看自動通知發送紀錄";
export const LINE_AUTOMATION_BACK_TO_MANAGE = "返回通知管理";
export const LINE_AUTOMATION_PREVIEW_MODE_LABEL = "預覽模式，尚未發送";
export const LINE_AUTOMATION_LOCAL_ONLY_BADGE = "尚未啟用";
export const LINE_AUTOMATION_LOCAL_PREVIEW_BADGE = "本機預覽中";
export const LINE_AUTOMATION_EMPTY_STAT = "—";
export const LINE_AUTOMATION_EMPTY_STAT_CAPTION = "尚無資料";
export const LINE_AUTOMATION_SETTINGS_LABEL = "設定規則";
export const LINE_AUTOMATION_APPLY_LOCAL_LABEL = "套用本機預覽";
export const LINE_AUTOMATION_SAVE_LABEL = "儲存設定";
export const LINE_AUTOMATION_SAVE_CLOSED_LABEL = "儲存設定（尚未開放）";
export const LINE_AUTOMATION_STATUS_OFF = "未啟用";
export const LINE_AUTOMATION_SENT_THIS_MONTH = "本月已發送";
export const LINE_AUTOMATION_ENABLED_COUNT = "已啟用通知";
export const LINE_AUTOMATION_HISTORY_ENTRY = "發送紀錄";
export const LINE_AUTOMATION_LAB_ENTRY = "開發測試專區";
export const LINE_AUTOMATION_LAB_TITLE = "LINE 自動通知開發測試專區";
export const LINE_AUTOMATION_LAB_HINT =
  "此區保留 Phase 3A 至 3C-2 模擬與安全檢查，不是店長日常操作畫面。不會發送真實 LINE。";
export const LINE_AUTOMATION_TIMING_LABEL = "發送時間";
export const LINE_AUTOMATION_TEMPLATE_LABEL = "訊息範本";
export const LINE_AUTOMATION_OWNER_ONLY = "只有店長可以使用 LINE 自動通知";
export const LINE_AUTOMATION_EDITOR_WARNING =
  "設定會儲存到此店家，但不會發送 LINE 訊息。";
export const LINE_AUTOMATION_REMINDER_DEV_TITLE = "預約提醒開發狀態";
export const LINE_AUTOMATION_REMINDER_DEV_HINT =
  "Phase 3A：先完成測試 LINE。本機可預覽排程，不會寫入正式資料庫，也不會發送 LINE。";
export const LINE_AUTOMATION_TEST_LINE_BADGE = "測試 LINE 優先";
export const LINE_AUTOMATION_TEST_MODE_HINT =
  "正式網站可查看管理介面。測試發送必須隔離，不得使用正式顧客或正式營業 LINE。";
export const LINE_AUTOMATION_REMINDER_PLAN_TITLE = "預約提醒本機排程";
export const LINE_AUTOMATION_REMINDER_PLAN_HINT =
  "只使用本機測試預約。取消或改期會讓未發送提醒失效。真實發送仍關閉。";
export const LINE_AUTOMATION_HISTORY_LOCAL_HINT = "以下是本機排程預覽，不是正式發送紀錄。";
export const LINE_AUTOMATION_DRY_RUN_TITLE = "預約提醒模擬模式";
export const LINE_AUTOMATION_DRY_RUN_BADGE = "模擬模式，不會發送 LINE";
export const LINE_AUTOMATION_DRY_RUN_HINT =
  "這是完整 Dry Run：建立模擬預約、產生兩則提醒、到期重驗、模擬發送。模擬完成不代表 LINE 已經發出。";
export const LINE_AUTOMATION_DRY_RUN_NOT_SENT = "未發送任何真實 LINE 訊息";
export const LINE_TEST_PUSH_PREP_TITLE = "測試 LINE 單次發送準備";
export const LINE_TEST_PUSH_PREP_BADGE = "發送按鈕已停用";
export const LINE_TEST_PUSH_PREP_HINT =
  "這是 Preview TEST 單次 Push 的安全檢查。檢查通過或本機模擬成功，都不代表 LINE 已經送達。";
export const LINE_TEST_PUSH_PREP_SEND_LABEL = "發送一則測試 LINE（尚未開放）";
export const LINE_TEST_PUSH_PREP_ENV_LABEL = "建議執行環境";
export const LINE_TEST_PUSH_PREP_RECIPIENT_LABEL = "測試接收者";
export const LINE_TEST_PUSH_PREP_CHANNEL_LABEL = "測試 Channel";
export const LINE_TEST_PUSH_PREP_UNKNOWN_BIND = "尚未唯讀確認（只顯示遮罩）";
export const LINE_TEST_PUSH_ACCEPT_TITLE = "Preview 綁定與單次發送安全驗收";
export const LINE_TEST_PUSH_ACCEPT_BADGE = "未知則不通過";
export const LINE_TEST_PUSH_ACCEPT_HINT =
  "本階段只做 Preview 唯讀確認與本機安全驗收。沒有資料庫存取權限時標記未知，不會用假資料宣稱通過，也不會發送 LINE。";
export const LINE_TEST_PUSH_ACCEPT_RECIPIENT_LABEL = "Preview 接收者";
export const LINE_TEST_PUSH_ACCEPT_SCHEMA_LABEL = "遠端資料結構";
export const LINE_TEST_PUSH_ACCEPT_CLAIM_LABEL = "授權與防重";
export const LINE_TEST_PUSH_ACCEPT_RETRY_LABEL = "超時重試";
export const LINE_TEST_PUSH_ACCEPT_BLOCK_LABEL = "封鎖與撤銷";
export const LINE_TEST_PUSH_ACCEPT_NEXT_LABEL = "下一個需核准動作";
export const LINE_TEST_PUSH_ACCEPT_UNKNOWN = "未知（不可宣稱通過）";
export const LINE_TEST_PUSH_ACCEPT_CLAIM = "必須遠端原子 claim，不可用本機集合";
export const LINE_TEST_PUSH_ACCEPT_RETRY = "超時、伺服器錯誤或結果不明都待確認，不自動重試";
export const LINE_TEST_PUSH_ACCEPT_BLOCK = "封鎖與撤銷未知時 fail-closed";
export const LINE_AUTOMATION_REMINDER_EDITOR_WARNING =
  "預約提醒仍在開發。此設定只本機預覽，不會寫入資料庫，也不會呼叫 LINE API。";
export const LINE_AUTOMATION_FLAG_CLOSED = "關閉";
export const LINE_AUTOMATION_FLAG_SEND_LABEL = "SEND";
export const LINE_AUTOMATION_FLAG_OWNER_SELF_LABEL = "OWNER_SELF_PUSH";
export const LINE_AUTOMATION_FLAG_KILL_LABEL = "KILL_SWITCH";
export const LINE_AUTOMATION_WRITE_CLOSED_LABEL = "正式寫入";
export const LINE_OWNER_SELF_TITLE = "店長本人預約提醒測試";
export const LINE_OWNER_SELF_HINT =
  "此區塊只顯示正式環境安全說明。不會寫入測試授權，也不會連接 LINE Push。";
export const LINE_OWNER_SELF_CLOSED_LABEL = "正式發送、授權寫入與店長本人測試都關閉";
export const LINE_OWNER_SELF_ONCE_ONLY_LABEL = "只限一次的預約提醒測試，不是全店自動提醒";
export const LINE_OWNER_SELF_FLOW_HINT =
  "正式環境只顯示流程說明：確認本人綁定 → 建立有期限授權 → 發行單次授權。此站不會執行授權或發送。";
export const LINE_OWNER_SELF_DISABLED_HINT =
  "正式環境已停用授權、oneshot 與發送操作。";
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
