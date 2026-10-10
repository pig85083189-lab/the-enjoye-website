# LINE Official Account — Phase 1C

Beauty OS SaaS 共用的 LINE 官方帳號串接、文字群發與店長安全測試發送。  
**Broadcast 與測試 Push 是獨立開關，兩者預設都關閉。**  
本階段只在 Preview 開發與驗證。Production Supabase、Production 環境變數與 Production 部署保持不變。

---

## A. 現有模組 Audit

| 模組 | 沿用方式 |
|------|----------|
| Organization | 既有 `organizations.app_id`（`org-%`）當租戶鍵。不新增第二套 Organization。 |
| LINE 官方帳號 | 沿用 `line_official_accounts` / `line_official_account_secrets`。每店自己的 Channel Access Token。 |
| 群發表 | 沿用 `line_broadcasts` / `line_broadcast_events`。不建平行發送系統。 |
| Staff RBAC | 沿用 `staff_auth_memberships`。只有 active `OWNER` 可確認真實發送。 |
| 加密憑證 | AES-256-GCM。Client 與 log 看不到 Secret / Token。 |
| 發送 Adapter | `executeLineBroadcastHttp` 仍被 `LINE_BROADCAST_SEND_OPEN = false` 擋住。測試只走 mock。 |
| LINE API | 連線測試 `GET /v2/bot/info`；額度 `GET /v2/bot/message/quota` + `/consumption`；Broadcast `POST /v2/bot/message/broadcast`（預設不呼叫）。 |
| Preview | 憑證表在修 UI 後仍為 0 列，沒有可覆寫或誤用的真實 token。 |

公開官網 CTA 仍使用既有 `lib/line.ts`。伺服器模組在 `lib/line/*`，**沒有** `lib/line/index.ts`。

---

## B. 新增與修改檔案

Phase 1C 新增：

- `supabase/migrations/20261010160000_line_owner_test_push.sql`
- `lib/line/line-bind.ts`、`line-webhook.ts`、`line-push-adapter.ts`
- `app/api/line/webhook/[organizationId]/route.ts`

Phase 1B 既有：claim / quota / send pipeline。Client 不引入 crypto、send、push adapter。

---

## C. 真實發送架構

流程維持 **Draft → Preview → Confirm → History**。

確認畫面有兩條分開的路，**沒有**把「確認（不會實際發送）」默默改成真送：

1. **練習確認** → `confirmLineBroadcastAction` → `send_closed`，不呼叫 LINE。
2. **真實發送** → 必須勾選「我了解這會向全部好友發送」→ `sendLineBroadcastAction`。

真實發送伺服器端順序：

1. active OWNER、店家隔離、草稿文字、request ID（`lbrq-%`）
2. 帳號已連線（token + 連線測試 ok）
3. 店長已啟用 `broadcast_enabled`
4. `LINE_BROADCAST_SEND_OPEN === true`
5. 應用每日上限與（若已知）LINE 額度
6. `claim_line_broadcast_send` 原子鎖定為 `sending`
7. 解密該 Organization 自己的 Access Token
8. `POST /v2/bot/message/broadcast`，`X-Line-Retry-Key = request_id`
9. `complete_line_broadcast_send` 寫入結果與 audit

成功文案只會是 **「LINE API 已接受」**。不宣稱全部好友已送達。

本階段常數仍是 `LINE_BROADCAST_SEND_OPEN = false` 與 `LINE_TEST_PUSH_OPEN = false`。

### 店長測試 Push（Phase 1C）

評估後採用 **簽章 Webhook + 一次性驗證碼**，不採用 LINE Login（需另一組 Login Channel，且不能證明收得到此 OA 的 Push），也不接受 Console 管理者 User ID。

1. active OWNER 產生 8 碼驗證碼（明文只回傳一次，資料庫只存 hash）
2. 店長用自己的 LINE 把驗證碼傳給本官方帳號
3. `POST /api/line/webhook/{orgId}` 用該店 Channel Secret 驗 `x-line-signature`
4. 通過後才把 `source.userId` 加密寫入 `line_owner_recipient_secrets`
5. 測試發送走 `POST /v2/bot/message/push`，對象只能是伺服器保存的綁定收件者
6. Client 不能傳 User ID；每日上限與 Broadcast 分開；原子 claim；timeout 不重送

---

## D. 額度檢查與防重複

額度：

- Adapter 唯讀查詢 LINE `quota` 與 `quota/consumption`
- 取得完整 limited 資料才計算剩餘
- 失敗、缺資料、尚未保存 token、或實際發送關閉 → 顯示 **未知**
- 發送關閉時不解密、不使用真實 Channel Token 查額度
- 不造好友數，不造剩餘額度

防重複：

- `(organization_id, request_id)` unique
- `FOR UPDATE` 原子 claim；`accepted` / `sending` / `pending_confirmation` 不能再送
- timeout / 例外 → `pending_confirmation`，**不自動重送**
- 同一 pipeline 的 HTTP 最多一次

---

## E. 測試

`lib/line/line-official-account.isolation.test.ts` 覆蓋：

- 多租戶隔離與非 Owner
- 重複發送、額度不足、API 失敗、timeout 不重送
- 草稿保存後重新整理仍可讀取
- send 關閉時 adapter 不打 HTTP
- mock Broadcast / 唯讀 quota
- Client 不引入 crypto / send / quota adapter
- 「確認（不會實際發送）」與「確認真實發送」同時存在
- Webhook 簽章、跨店 code、未授權收件者、測試重複/併發
- 測試 Push adapter 預設不打 HTTP，路徑是 `/message/push` 不是 Broadcast

---

## G / H. 部署邊界與首次真實發送驗收

| 環境 | 狀態 |
|------|------|
| Preview | Ready：`https://the-enjoye-website-7xns5ggxd-pig85083189-6631s-projects.vercel.app`（`8e07746`，`dpl_8ub6oFjh5SYTQXDc3PW43pPGgfGv`）。別名 `https://the-enjoye-website-git-cursor-98180f-pig85083189-6631s-projects.vercel.app`。已套用 `20261010140000` 到 Preview Supabase `bfzquejrtgqzzarhkiya`。未呼叫 Broadcast。 |
| Production | **未變**。仍是 staff-auth release `dpl_DGWw59QtgvjqrZpHyE6WufJV2Skb` / `e3c750d`。Production Supabase `knccefcxncglgpmvgqlp` 沒有 LINE 表。沒有 LINE env。不部署 Production。不合併 main。 |

### 後續首次真實發送驗收（尚未授權，不要在本 PR 做）

1. 使用**專用測試官方帳號**，禁止 THE ENJOYE 或任何已有真實好友的帳號。
2. 只在 Preview 打開伺服器開關；Production 保持關閉。
3. Owner 完成連線測試、啟用群發、確認額度不是未知且足夠。
4. 用極短測試文字走「確認真實發送」，勾選知情同意。
5. 預期：歷史顯示「LINE API 已接受」，audit 有 `send_claimed` + `api_accepted`。
6. timeout 必須停在待確認，不得重送。
7. 驗收後立刻把 `LINE_BROADCAST_SEND_OPEN` 關回 false。
