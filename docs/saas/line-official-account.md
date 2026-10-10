# LINE Official Account — Phase 1D

本文件延續 Phase 1、Phase 1B、Phase 1C：可重用的官方帳號串接、文字 Broadcast、店長測試 Push。發送開關預設關閉。

Beauty OS SaaS 共用的 LINE 官方帳號串接、文字群發與店長安全測試發送。  
**Broadcast 與測試 Push 是獨立開關，兩者預設都關閉。**  
本階段只在 Preview 準備真實 Webhook 綁定與單人 Push 驗收，**不發送任何真實 LINE 訊息**。  
Production Supabase、Production 環境變數與 Production 部署保持不變。

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
| 測試 Push | `executeLineTestPushHttp` 仍被 `LINE_TEST_PUSH_OPEN = false` 擋住。測試只走 mock。 |
| LINE API | 連線測試 `GET /v2/bot/info`；額度唯讀；Broadcast / Push 預設不呼叫。 |
| THE ENJOYE | Preview 已保存憑證。本階段不得覆蓋，也不得修改其既有官方帳號 Webhook。 |

公開官網 CTA 仍使用既有 `lib/line.ts`。伺服器模組在 `lib/line/*`，**沒有** `lib/line/index.ts`。

---

## B. 新增與修改檔案

Phase 1D 新增：

- `supabase/migrations/20261010180000_line_webhook_least_privilege.sql`
- `app/api/line/webhook/[organizationId]/[publicToken]/route.ts`
- `lib/line/line-webhook-limits.ts`、`line-webhook-url.ts`
- `lib/supabase/anon.ts`（publishable key，不用 service role）

舊路徑 `POST /api/line/webhook/{orgId}` 改為 404，不再使用 service role。

---

## C. Webhook 與測試發送架構

### 公開接收

1. Next `proxy.ts` 只匹配 `/staff`，**不會**把 LINE webhook 導向登入。
2. Webhook URL 為 `https://<Preview 分支網域>/api/line/webhook/{orgId}/{publicToken}`。
3. 簽章使用 `request.text()` 的原始 body，以該 Organization 的 Channel Secret 做 HMAC-SHA256，對照 `x-line-signature`。
4. 驗證碼 8 碼 hex、明文只回傳一次、資料庫只存 `orgId:CODE` 的 SHA-256；10 分鐘失效；錯誤 5 次即作廢。
5. `webhookEventId` 以 `(organization_id, event_id)` 去重；重送不再 consume。

### 最小權限

Webhook **不再使用** `SUPABASE_SERVICE_ROLE_KEY`。  
匿名 publishable client 只能呼叫 token-gated SECURITY DEFINER RPC：

| RPC | 回傳 |
|-----|------|
| `read_line_webhook_channel_secret_cipher` | 僅 Channel Secret **密文** |
| `claim_line_webhook_event` | 事件去重 |
| `consume_line_owner_bind_challenge_public` | 綁定結果 |

上述 RPC 在 token 不符時不回 Access Token、不回明文 Secret。Client / log 看不到密文解密結果。

### 店長測試 Push

流程不變：簽章 Webhook + 一次性驗證碼。不採用 LINE Login，不接受 Console 管理者 User ID。

1. active OWNER 產生驗證碼
2. 店長用自己的 LINE 把驗證碼傳給**專用測試官方帳號**
3. Webhook 驗簽後加密 `source.userId`
4. 測試發送走 `POST /v2/bot/message/push`，本階段常數仍關閉，不會真的呼叫

本階段常數仍是 `LINE_BROADCAST_SEND_OPEN = false` 與 `LINE_TEST_PUSH_OPEN = false`。

---

## D. 額度檢查與防重複

額度：

- Adapter 唯讀查詢 LINE `quota` 與 `quota/consumption`
- 發送關閉時不解密、不使用真實 Channel Token 查額度
- 不造好友數，不造剩餘額度

防重複：

- Broadcast / test send：`(organization_id, request_id)` unique、原子 claim
- timeout / 例外 → `pending_confirmation`，**不自動重送**
- Webhook：`line_webhook_events` 對 `webhookEventId` 去重

---

## E. 測試

`lib/line/line-official-account.isolation.test.ts` 覆蓋：

- 多租戶隔離與非 Owner
- 重複發送、額度不足、API 失敗、timeout 不重送
- send 關閉時 adapter 不打 HTTP
- Webhook 原始 body 簽章、跨店 code、未授權收件者
- 過期驗證碼、5 次嘗試上限、重複事件、失敗簽章
- 測試 Push adapter 預設不打 HTTP
- Webhook route 不使用 service role；公開 RPC 不回 Access Token

---

## 專用測試官方帳號安全設定

只建立**新的測試官方帳號**。不要動 THE ENJOYE 既有 Messaging API Channel。

1. LINE Official Account Manager 建立新帳號（名稱標明 Preview / 測試）。
2. LINE Developers 建立 Messaging API Channel。
3. 發行 Channel ID、Channel Secret、Channel Access Token。
4. 在 Beauty OS Preview **另一間測試店家**（不要覆寫 THE ENJOYE 已保存憑證）由 Owner 加密保存。
5. 開啟 Messaging API webhook，URL 只貼 Settings 顯示的  
   `/api/line/webhook/{orgId}/{publicToken}`。  
   **不得修改 THE ENJOYE 現有官方帳號的 Webhook。**
6. 使用驗證：LINE 會 POST 空 `events`；本系統在簽章通過後回 200。
7. 不要把 Vercel 全站 `x-vercel-protection-bypass` 填進 THE ENJOYE。若 Preview 仍有 Deployment Protection SSO，只把**此測試帳號**的 webhook 指到已解除保護的 Preview 分支網域，或請 Owner 把該 Preview 分支網域加入 Deployment Protection Exceptions。不要關閉 Production 保護。
8. 不要把 Console 管理者 User ID 當收件者。
9. 不要開啟 `LINE_TEST_PUSH_OPEN` 或 `LINE_BROADCAST_SEND_OPEN`（本 PR 也不會開）。

---

## Owner 操作步驟（本階段不發送）

1. 用 Owner 登入 Preview `/staff/settings/line`。
2. 確認 THE ENJOYE 憑證狀態仍是已保存；**不要按加密保存去覆蓋**，除非你在另一間測試店家寫入測試帳號憑證。
3. 複製「專用測試官方帳號 Webhook URL」，只貼到測試帳號。
4. 按「產生驗證碼」，10 分鐘內用自己的 LINE 把 8 碼傳給測試官方帳號。
5. 畫面應顯示已綁定 `••••` 遮罩。失敗、過期或超過 5 次需重產驗證碼。
6. 「店長啟用測試發送」只是店內旗標。實際 Push 仍關閉。
7. 群發中心的「確認（不會實際發送）」維持練習鈕；「確認測試發送」本階段會因伺服器開關關閉而拒絕，且不會呼叫 LINE。

---

## G / H. 部署邊界與首次真實 Push 驗收條件

| 環境 | 狀態 |
|------|------|
| Preview | 本階段部署後更新。已套用 `20261010180000` 到 Preview Supabase `bfzquejrtgqzzarhkiya`。未呼叫 Push / Broadcast。未開啟發送開關。 |
| Production | **未變**。仍是 staff-auth release `dpl_DGWw59QtgvjqrZpHyE6WufJV2Skb` / `e3c750d`。Production Supabase `knccefcxncglgpmvgqlp` 沒有 LINE 表。沒有 LINE env。不部署 Production。不合併 main。 |

### 首次真實 Push 驗收（尚未授權，本階段不做）

具備條件：

- 專用測試官方帳號已綁 Webhook（不是 THE ENJOYE）
- Owner 已用驗證碼完成本人綁定
- Preview Webhook 可被 LINE 公開打到（無 SSO / 登入導向）
- `LINE_TEST_PUSH_OPEN` 仍關閉，需另一次明確授權才打開
- Production 保持關閉

還不能算「可以立刻真送」。要真送時必須另開授權：只在 Preview 打開 `LINE_TEST_PUSH_OPEN`，用極短文字走「確認測試發送」，成功只表示 API 已接受，驗收後立刻關回。
