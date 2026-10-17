# Phase 2F-6 Option B / C analysis

Local design and isolation only. Developers URL, remote SQL, send flags, and Broadcast are unchanged.

2F-5 的本機原型可以同時讀兩份模擬庫，並用同一個 `Set` 做碰撞與事件去重。真實 Preview（`bfzquejrtgqzzarhkiya`）與 Production（`knccefcxncglgpmvgqlp`）完全分離，那個檢查不能當遠端安全保證。

## A. 方案 B 是否真正可安全落地

**沒有全域協調器時：否。**

Preview 看不到 Production challenge，Production 也看不到 Preview challenge。下列事項無法用「本機同時掃兩庫」證明：

1. 同一 8 碼此刻是否同時有效於 TEST 與 Enjoye
2. 同一 `webhookEventId` 是否已在另一環境建立綁定
3. 轉送超時後，對端是否已消耗

因此「無法證明唯一時拒絕綁定」是預設。不得假設跨庫交易、跨庫 unique index，或 Preview 持有 Production `service_role` / 加密金鑰。

B 若要落地，只能用**驗證碼命名空間**（TEST `0-7*******`、Enjoye `8-F*******`）在發行時證明全 Channel 唯一，再加上 Production 重驗簽章與 fail closed。這比再開一個 LINE Channel 更重，也更容易在超時／重放上做錯。

## B. 跨環境唯一性及去重的具體保證

| 保證 | 作法 | 不做什麼 |
| --- | --- | --- |
| 相同 8 碼不能同時有效 | 發行時強制命名空間。TEST 碼不能發到 Production，Enjoye 碼不能發到 Preview | 不查另一個資料庫 |
| 無法證明唯一 | 未分區碼直接拒絕，不轉送、不消耗 | 不把 Preview 未命中當 Production 命中 |
| 同一 webhookEventId | Preview 只 claim TEST 消耗；Production 先 claim 再消耗 Enjoye | 兩邊不共用 event Set |
| 並發 / 5xx / 斷線 | 超時不消耗；Production 重放走 duplicate | 不錯綁、不重綁 |
| 憑證隔離 | Preview 只驗 TEST；轉送只帶原始 body + LINE 簽章 | Preview 不持有 Production 金鑰 |

轉送協定：

1. Preview 驗簽章。Enjoye 命名空間 → `forward_candidate`。TEST 命名空間才查 Preview challenge。
2. TEST 未命中 → `unknown`，**停止**。這不是 Production 命中。
3. Production 公開入口必須重驗原始 body 與簽章。沒有有效 LINE 簽章就拒絕，避免公開入口被濫用。
4. Production 只查 Enjoye challenge。未命中 → `unknown`。
5. 稽核只記 `action` / `eventId` / `organizationId`，不記驗證碼、Secret、service_role。

## C. 三種架構比較

| | A 中立 Gateway | B 受限轉送 + 全域協調 | C 分開 LINE Messaging API Channel |
| --- | --- | --- | --- |
| 正式上線安全 | 兩庫分離時仍看不到全 Channel | 需命名空間或外部協調器；轉送超時複雜 | TEST 與 Enjoye 不再共用 Webhook 與驗證碼空間 |
| 系統複雜度 | 高：新主機、雙 RPC | 高：轉送、重驗、雙邊去重、命名空間 | 低：多一個測試 Channel |
| 維護成本 | 長期可收斂，現在過重 | 過渡方案，維護負擔最高 | 最低 |
| 既有 Broadcast | 不改發送程式 | 不改發送程式，但仍共用 Channel lock `870121` | 正式群發留在 `2009219238`，不改發送程式 |
| SaaS 多店 | 同庫多店後較適合 | 不適合當長期多租戶 | 一店一 Channel，或同庫多店再做 Gateway |

## D. 最推薦的方案

**C. 分開使用不同 LINE Messaging API Channel。**

正式 Channel `2009219238`（@357gospk）只服務 THE ENJOYE Production：既有 Broadcast、未來正式 Owner 綁定、未來正式 Webhook。另開測試 Channel 給 Preview + `org-beauty-os-test`。

本階段仍不改 Developers URL、不部署、不開 SEND。C 的切換是後續最小階段，不是現在執行。

## E. 本機檔案

- `lib/line/webhook-routing/constrained-forward.ts`
- `lib/line/webhook-routing/constrained-forward.isolation.test.ts`
- this file

未接到 `app/api/line/webhook/...`。未讀遠端 Secret。

## F. BLOCKER

- Developers URL 仍是舊 Preview + TEST 路徑
- 正式 Enjoye 綁定啟動仍關閉（2F-4）
- Production Enjoye public token / 加密金鑰尚未唯讀確認
- 沒有第二個 LINE Channel 時，B 不能安全落地
- 不得把此原型接到真實 Webhook

## G. 下一個最小可執行階段

Owner 核准 C 後：準備測試 Channel 申請清單與正式 Channel 只服務 Enjoye 的切換／回復草稿。仍不改 Developers URL、不部署、不產生真實驗證碼、不開 SEND。
