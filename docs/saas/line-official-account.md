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
| 測試 Push | `LINE_TEST_PUSH_OPEN = false`。只有 Preview allowlist（尚未設定 env）才能開。測試只走 mock。 |
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
2. Webhook URL 為 `https://<專用 webhook 主機>/api/line/webhook/{orgId}/{publicToken}`。Staff Preview 主機維持保護。
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
測試 Push 另外要求 Preview-only allowlist，**目前沒有設定** `BEAUTY_OS_LINE_TEST_PUSH_OPEN` / `BEAUTY_OS_LINE_TEST_PUSH_ORG`。Broadcast **沒有**環境變數繞過。

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
7. Webhook 只貼專用 Preview 別名  
   `https://the-enjoye-line-webhook-preview-pig85083189-6631s-projects.vercel.app`  
   不要把 `x-vercel-protection-bypass` 填進任何官方帳號。不要改 THE ENJOYE Webhook。不要關閉 Production 或 Staff Preview 保護。
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
| Preview | READY：`https://the-enjoye-website-40dw6roe0-pig85083189-6631s-projects.vercel.app`（`8942f53`，`dpl_fhgwomtoh5G461UezFVDNpN4id9B`）。Staff 別名仍受 SSO 保護。Webhook 別名見下方。已套用 `20261010180000`。THE ENJOYE 憑證未改。未呼叫 Push / Broadcast。未開啟發送開關。 |
| Production | **未變**。仍是 staff-auth release `dpl_DGWw59QtgvjqrZpHyE6WufJV2Skb` / `e3c750d`。Production Supabase `knccefcxncglgpmvgqlp` 沒有 LINE 表。沒有 LINE env。不部署 Production。不合併 main。 |

### Preview Webhook 公開存取（Owner 已核准 A+B）

專用別名（git branch `cursor/line-official-account-phase-1-7c7d`，不指 Production）：  
`https://the-enjoye-line-webhook-preview-pig85083189-6631s-projects.vercel.app`

Deployment Protection Exception 只加在這個別名（`alias-protection-override`）。  
Staff git 分支網域與單一 Preview URL 仍 302 SSO。Production 別名沒有這個網域。

未登入實測：

| 請求 | 結果 |
|------|------|
| GET webhook 別名 `/api/line/webhook/{org}/{token}` | 200 `{ok:true,bound:false}`（未登入） |
| POST 無簽章 / 偽造簽章 / 空 events / group source / 假 userId | 403 |
| GET 過短 token 或非 `org-` | 404 |
| GET webhook 別名 `/`、`/staff`、`/staff/login`、`/staff/settings/line`、`/admin` | 404（Host Lock） |
| GET Staff Preview 分支網域 | 302 `Protected by Vercel Authentication` |
| GET 單一 Preview URL | 302 `Protected by Vercel Authentication` |
| Production `/`、`/staff` | 307 `/staff/login`（原行為） |
| Production webhook 路徑 | 404（Production 沒有此路由） |

下一步（仍不發送真實訊息、不開開關）：

1. Preview 已建立獨立店家 `org-beauty-os-test`（Beauty OS TEST）。Owner 可在 Staff Preview 切換。
2. 不要改 THE ENJOYE Webhook 或憑證。不要覆蓋 THE ENJOYE 的加密保存。
3. 切到 Beauty OS TEST 後，由 Owner **自己在畫面輸入** `ai` 的 Channel 憑證。
4. 從 Settings 複製 Webhook URL（會是專用 webhook 別名）。暫時不要改 `ai` Webhook，等另一次授權。
5. `LINE_TEST_PUSH_OPEN` 與 `LINE_BROADCAST_SEND_OPEN` 保持 false。不要把常數改成 true。
6. 不要設定 `BEAUTY_OS_LINE_TEST_PUSH_OPEN` 或 `BEAUTY_OS_LINE_TEST_PUSH_ORG`，直到另一次明確授權。

### Preview-only Test Push Allowlist

`isLineTestPushOpen` 只有同時成立才為 true：

1. `BEAUTY_OS_LINE_CONNECTION_PILOT=1`
2. `BEAUTY_OS_LINE_TEST_PUSH_OPEN=1`
3. `BEAUTY_OS_LINE_TEST_PUSH_ORG=org-beauty-os-test`
4. 伺服器驗證過的 `organizationId === org-beauty-os-test`
5. `VERCEL_ENV` 不是 `production`

缺少任一條件一律關閉。THE ENJOYE 與其他 Organization 不能用。Production 即使誤設 env 也關閉。發送入口使用 `loadVerifiedLineOrganization`，不用 Client 任意指定的店家。

`claim_line_test_send` 在同一交易鎖定該店 `line_official_accounts`、計算當日 `accepted/sending/pending_confirmation`、再原子改 `sending`。每日上限 3。

### Phase 1D.1 — requestId 防重用與 Runtime Kill Switch

失敗 / 已接受 / 待確認 / 發送中的 `ltsq-` **不得重用**。claim RPC 拒絕這些狀態；UI 在成功或失敗後都會改發新的 requestId。歷史失敗列不回寫。

Preview-only 伺服器總開關是 `line_official_accounts.test_push_runtime_open`，預設 `false`。每次 claim 都在同一列 `FOR UPDATE` 下重讀。查詢失敗或不是 `org-beauty-os-test` 一律拒絕。Production 永遠禁止。Broadcast 仍 hardcoded false。前端參數不能繞過。

Owner 立即停止後續新發送（不需重新部署）：

1. Preview 先套用 `20261011010000_line_test_push_runtime_kill_switch.sql`（需另一次授權）。
2. 在 Beauty OS TEST 的 `/staff/settings/line` 按「立即關閉測試發送總開關」，或在 Preview SQL 執行  
   `select public.set_line_test_push_runtime_open('org-beauty-os-test', false);`
3. 已開始的 LINE HTTP 無法保證取消。只能保證拒絕後續新發送。

### Phase 1D.4 — Push Retry-Key 與單人測試操作

`X-Line-Retry-Key` 必須是 hexadecimal UUID，不可把內部 `ltsq-` / `lbrq-` 識別碼直接送給 LINE。同一 requestId 會穩定對應同一 UUID，歷史失敗列不回寫、不自動重送。LINE HTTP 400 只記 `invalid_request`；本機預檢的 `invalid_recipient` / `invalid_message` / `invalid_retry_key` 在沒有 LINE 回應時才使用，寫入資料庫時仍對應 `invalid_request`。

群發中心把「單人測試 Push」與「正式群發」分開。測試有獨立區塊與一次「確認測試發送」。伺服器 allowlist、Owner、已綁定收件者、每日額度、requestId 防重用與 Runtime Kill Switch 仍有效。Broadcast 維持 hardcoded false。

### 首次真實 Push 驗收（尚未授權，本階段不做）

具備條件：

- 專用測試官方帳號已綁 Webhook（不是 THE ENJOYE）
- Owner 已用驗證碼完成本人綁定
- Preview Webhook 可被 LINE 公開打到（無 SSO / 登入導向）
- Allowlist 程式已就緒，**發送 env 尚未設定**
- Production 保持關閉

還不能算「可以立刻真送」。要真送時必須另開授權：只在 Preview 分支設定上述兩個 env、套用 `20261010190000` claim quota migration，用極短文字走「確認測試發送」，成功只表示 API 已接受，驗收後立刻刪除 env 並重新部署。
