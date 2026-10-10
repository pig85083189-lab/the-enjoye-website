# LINE Official Account — Phase 1B

Beauty OS SaaS 共用的 LINE 官方帳號串接與文字群發中心。  
**Phase 1B 已接好真實 Broadcast 架構，但實際發送預設維持關閉。**  
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

Phase 1B 新增：

- `supabase/migrations/20261010140000_line_broadcast_real_send.sql`
- `lib/line/line-quota.ts`
- `lib/line/line-quota-adapter.ts`
- `lib/line/line-send-pipeline.ts`

修改：

- `lib/line/actions.ts`、`line-command.ts`、`line-send-adapter.ts`、`line-types.ts`、`line-visibility.ts`、`line-flag.ts`
- `features/line/LineBroadcastCenter.tsx`、`LineOfficialAccountSettings.tsx`
- isolation tests、schema-contract、migration chain、本文件

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

本階段常數仍是 `LINE_BROADCAST_SEND_OPEN = false`，因此 Preview 會在第 4 步拒絕，記錄 `send_refused`，**不 claim、不解密發送、不打 Broadcast**。

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

---

## G / H. 部署邊界與首次真實發送驗收

| 環境 | 狀態 |
|------|------|
| Preview | 只在此分支部署與套用 `20261010140000`。不打真實 Broadcast。 |
| Production | **未變**。Production Supabase `knccefcxncglgpmvgqlp` 沒有 LINE 表。沒有 LINE env。不部署 Production。不合併 main。 |

### 後續首次真實發送驗收（尚未授權，不要在本 PR 做）

1. 使用**專用測試官方帳號**，禁止 THE ENJOYE 或任何已有真實好友的帳號。
2. 只在 Preview 打開伺服器開關；Production 保持關閉。
3. Owner 完成連線測試、啟用群發、確認額度不是未知且足夠。
4. 用極短測試文字走「確認真實發送」，勾選知情同意。
5. 預期：歷史顯示「LINE API 已接受」，audit 有 `send_claimed` + `api_accepted`。
6. timeout 必須停在待確認，不得重送。
7. 驗收後立刻把 `LINE_BROADCAST_SEND_OPEN` 關回 false。
