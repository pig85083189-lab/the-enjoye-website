# Phase 3A：測試 LINE 優先完成自動化

Owner 確認 Channel `2009219238` 是測試 LINE 官方帳號。THE ENJOYE 真正營業帳號尚未串接。2F-5 / 2F-6 Gateway 與 Channel 遷移研究保留為 Draft PR，不合併。本階段不改 Developers Webhook、不部署、不套用 Production SQL、不開 SEND、不改既有 Broadcast。

## A. 六個功能完成度

| 功能 | 狀態 | 說明 |
| --- | --- | --- |
| 群發訊息 | 部分完成 | 正式網站有群發中心、lock、額度；SEND 關閉 |
| LINE 綁定 | 部分完成 | webhook_code 可用；不管 follow / 封鎖 |
| 預約提醒 | 僅 UI → 本階段補本機排程 | 管理介面已有；現在有本機資料模型 |
| 生日／節慶／滿意度／優惠券 | 僅 UI | 有開關與範本，無排程 |
| 發送紀錄與額度 | 部分完成 | 群發有歷史；自動推播仍無真實紀錄 |
| 取消訂閱、封鎖與排程 | 尚未開發 | Webhook 不處理封鎖；無 cron |

## B. 可直接沿用

- `/staff/line` 群發中心與額度／lock
- `/staff/line/automations` Owner-only 管理 UI
- webhook_code 綁定與簽章驗證
- `Asia/Taipei` 預約時間工具
- Production-safe 發送開關（全部關閉）

## C. 需要補齊

- 預約提醒：取消／改期失效、去重、額度、速率、對象隔離（本階段本機已做）
- 其餘四個自動推播模組的排程與紀錄
- 封鎖／取消訂閱
- 測試 LINE 真實發送（另一次核准）
- 正式營業 LINE（最後）

## D. 預約提醒最小可開發範圍

本階段只做本機：

- 預約前一天 10:00（Asia/Taipei）
- 預約前 3 小時
- 取消或改期讓未發送 job 失效
- `org + appointment + kind + version` 去重
- 後台開關
- 本機發送紀錄與失敗原因
- 額度未知／用盡與速率上限 fail closed
- 正式顧客不得自動成為測試對象
- **不**呼叫 LINE、**不**寫 Production

## E. 正式網站安全測試模式

`official_site_ui_isolated`：

- 正式網站可看管理 UI
- 不得從正式顧客自動建立測試對象
- 不得複製 Preview 綁定
- 2009219238 不是正式營業 LINE
- 不得開自動發送
- TEST webhook_code 不得對應正式 Owner
- 兩邊資料庫不共用

## F. 開發與驗收順序

1. 盤點與隔離政策（本階段）
2. 預約提醒本機模型／介面／測試（本階段）
3. 預約提醒本機驗收
4. 生日 → 節慶 → 滿意度 → 優惠券
5. 另一次核准才開測試 LINE 發送
6. 最後才串接正式營業 LINE

## G. 本階段檔案

- `lib/line/automations/phase-3a-inventory.ts`
- `lib/line/automations/appointment-reminder-schedule.ts`
- `features/line/automations/LineAppointmentReminderPlanCard.tsx`
- 對應 isolation 測試

未接到 webhook route。未修改 Broadcast。未新增 migrations。
