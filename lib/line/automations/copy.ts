export const LINE_AUTOMATION_PAGE_TITLE = "LINE自動推播設定";
export const LINE_AUTOMATION_PAGE_SUBTITLE =
  "設定自動發送規則，讓系統在適當時機主動關心您的客人，提升回訪與滿意度";

export const LINE_AUTOMATION_NOT_LIVE_HINT =
  "自動推播尚未正式啟用，不會發送 LINE 訊息。";
export const LINE_AUTOMATION_LOCAL_DRAFT_HINT =
  "開關與規則僅本機預覽，不會寫入資料庫，也不會建立排程。";
export const LINE_AUTOMATION_REMINDER_BACKEND_HINT =
  "預約提醒已接上可測試後端。正式寫入與正式發送仍關閉。";
export const LINE_AUTOMATION_PERSIST_CLOSED_MESSAGE =
  "資料庫尚未接通或正式寫入尚未開放，規則沒有儲存成功。";
export const LINE_AUTOMATION_PERSIST_SAVED_MESSAGE = "預約提醒規則已儲存。正式發送仍關閉。";
export const LINE_AUTOMATION_DB_NOT_READY = "尚未接通資料庫，不會假裝已經儲存。";
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
export const LINE_AUTOMATION_SAVE_RULE_LABEL = "儲存規則（正式寫入關閉）";
export const LINE_AUTOMATION_EDITOR_WARNING =
  "此設定僅存在於此瀏覽器工作階段，不會寫入資料庫，也不會呼叫 LINE API。";
export const LINE_AUTOMATION_REMINDER_EDITOR_WARNING =
  "預約提醒可送出後端檢查，但正式寫入與正式發送仍關閉，系統不會呼叫 LINE API。";
export const LINE_AUTOMATION_SAVED_BADGE = "已儲存";
export const LINE_AUTOMATION_BIND_COUNT_LABEL = "已驗證的客人綁定";
export const LINE_AUTOMATION_CONSENT_COUNT_LABEL = "已同意接收預約提醒";
export const LINE_AUTOMATION_PLANNED_COUNT_LABEL = "預定提醒";
export const LINE_AUTOMATION_DRY_RUN_EMPTY = "尚無 Dry-run 紀錄。正式發送關閉，不會連接 LINE Push。";
export const LINE_AUTOMATION_START_BIND_LABEL = "產生客人綁定驗證碼";
export const LINE_AUTOMATION_DRY_RUN_ACTION_LABEL = "執行 Dry-run 檢查";
export const LINE_AUTOMATION_BIND_HINT =
  "請請客人用自己的 LINE 把驗證碼傳給本官方帳號。傳送驗證碼只完成綁定，不會自動同意預約提醒。";
export const LINE_AUTOMATION_CONSENT_HINT =
  "客人綁定後，需另外傳送「同意預約提醒」才會收到提醒。傳送「退訂」可取消訂閱，傳送「解除綁定」可解除綁定。";
export const LINE_AUTOMATION_BIND_CREATED_MESSAGE =
  "驗證碼已產生。客人傳送驗證碼只完成綁定，不會自動同意預約提醒。";
export const LINE_CONTROLLED_PUSH_TITLE = "受控測試發送（Preview）";
export const LINE_CONTROLLED_PUSH_HINT =
  "只允許 Beauty OS TEST 的指定假客戶。必須先完成官方 Webhook 綁定，再另外傳送「同意預約提醒」。本階段只檢查，不會連接 LINE Push。";
export const LINE_CONTROLLED_PUSH_CHECK_LABEL = "檢查受控發送（不會連接 LINE）";
export const LINE_CONTROLLED_PUSH_BIND_LABEL = "為指定假客戶產生綁定碼";
export const LINE_CONTROLLED_PUSH_CLOSED_LABEL = "正式發送與受控發送都關閉";
export const LINE_CONTROLLED_PUSH_PHRASE_LABEL = "二次確認文句";
export const LINE_CONTROLLED_PUSH_ONESHOT_LABEL = "單次授權";
export const LINE_CONTROLLED_PUSH_REMAINING_LABEL = "今日剩餘測試額度";
export const LINE_CONTROLLED_PUSH_PREVIEW_LABEL = "預計發送內容";
export const LINE_CONTROLLED_PUSH_KILL_LABEL = "停止開關";
export const LINE_CONTROLLED_PUSH_BIND_STATUS_LABEL = "已驗證綁定";
export const LINE_CONTROLLED_PUSH_CONSENT_STATUS_LABEL = "獨立同意預約提醒";
export const LINE_OWNER_SELF_TITLE = "店長本人預約提醒測試（Preview）";
export const LINE_OWNER_SELF_HINT =
  "沿用 THE ENJOYE LINE，不改正式 Webhook。這是只限一次的店長本人預約提醒測試，不是全店自動提醒。既有 test-push 綁定只能證明身分，不能代替這次同意。本階段只檢查，不會連接 LINE Push。";
export const LINE_OWNER_SELF_CHECK_LABEL = "檢查店長本人發送（不會連接 LINE）";
export const LINE_OWNER_SELF_CLOSED_LABEL = "正式發送、受控發送與店長本人測試都關閉";
export const LINE_OWNER_SELF_BIND_LABEL = "既有店長 Webhook 綁定";
export const LINE_OWNER_SELF_CONSENT_LABEL = "這次預約提醒測試的獨立同意";
export const LINE_OWNER_SELF_TRUST_LABEL = "可信店長本人收件者";
export const LINE_OWNER_SELF_ACK_LABEL =
  "我了解這次只會發給我自己一則測試，不是開啟全店自動提醒";
export const LINE_OWNER_SELF_ACK_NOTE =
  "勾選只是畫面提示。伺服器必須另外建立有期限的授權列才算同意，前端勾選、瀏覽器暫存或可偽造的 API 參數都不能代替。";
export const LINE_OWNER_SELF_ONCE_ONLY_LABEL = "只限一次的預約提醒測試，不是全店自動提醒";
export const LINE_OWNER_SELF_GRANT_LABEL = "建立本人測試授權（本階段不寫入）";
export const LINE_OWNER_SELF_REVOKE_LABEL = "撤回本人測試授權（本階段不寫入）";
export const LINE_OWNER_SELF_ISSUE_LABEL = "發行單次授權（本階段不寫入）";
export const LINE_OWNER_SELF_FLOW_HINT =
  "流程：登入 TEST → 確認遮罩綁定 → 主動同意只收一則測試 → 伺服器建立 24 小時授權 → 發行 2 小時 oneshot。發送尚未開放。";
export const LINE_OWNER_SELF_PERSIST_CLOSED =
  "Preview 授權寫入尚未開放。沒有寫入遠端 SQL，也沒有連接 LINE。";
export const LINE_AUTOMATION_BIND_RATE_LIMITED_MESSAGE = "驗證碼產生過於頻繁，請稍後再試。";
export const LINE_AUTOMATION_BIND_ATTEMPT_LIMITED_MESSAGE =
  "驗證嘗試次數過多，已暫時鎖定。請稍後再試。";
