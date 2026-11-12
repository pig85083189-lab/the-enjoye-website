# Phase 3B appointment reminder dry run

Built on Production-safe UI (`9e3db40`) + Phase 3A (`0b99cf1` / PR #57). Test LINE `2009219238` first. Does not send LINE, apply SQL, create Cron, or change Broadcast.

## A. Dry Run 流程

可重複入口：

```bash
npm run test:reminder-dry-run
```

或呼叫 `runCanonicalAppointmentReminderDryRun()`。

流程：建立模擬預約（2026/10/20 16:00 Asia/Taipei）→ 產生前一天 10:00 與前 3 小時兩則 job → 到期檢查 → 重新驗證 → 模擬發送 → 寫入 `sentLine: false` 的執行紀錄。

每次執行重驗：organizationId、預約存在、BOOKED/CONFIRMED、未取消、時間與 version、開關、明確測試接收者、未退訂／封鎖、額度與速率、去重。無法確認就跳過並留原因。

## B. 未來真實排程（本階段不落地）

`futureReminderRuntimePlan()`：持久化 Job、原子 claim、超時未知重試、審計、可支撐 3 小時窗的 queue／高頻 tick。`appliesSqlThisPhase=false`，`createsCronThisPhase=false`。

## C. 距離真正發送一則測試 LINE

仍缺：Owner 核准測試發送、測試 Channel 憑證只給 Preview／指定環境、真實 recipient 綁定、持久化 Job 與 Cron、SEND 仍關閉。本階段不得發送。
