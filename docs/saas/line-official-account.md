# LINE Official Account — Phase 1

Beauty OS SaaS 共用的 LINE 官方帳號串接與文字群發中心。  
**Phase 1 不發送真實 Broadcast。** Production Supabase、Production 環境變數與 Production 部署保持不變。

---

## A. 現有模組 Audit

| 模組 | 沿用方式 |
|------|----------|
| Organization | 既有 `organizations.app_id`（`org-%`）當租戶鍵。不新增第二套 Organization。 |
| Location | LINE 是店家層級官方帳號，不依分店複製連線。 |
| Staff RBAC | 沿用 `staff_auth_memberships`。只有 active `OWNER` 可管理。 |
| Supabase client/server | 一般讀取走 `createClient()`；密文解密走 `createServiceRoleClient()`，且先通過 Owner gate。 |
| Settings | 設定分類仍只有「店家設定」啟用。LINE 是獨立頁 `/staff/settings/line` 與入口卡片。 |
| Sidebar | 新增 Owner-only「LINE 群發」→ `/staff/line`。可見性不是授權。 |
| RLS / migration | 接在 `20261008130000` 之後的 additive migration。不改寫已發布檔。 |

公開官網 CTA 仍使用既有 `lib/line.ts`（`NEXT_PUBLIC_LINE_URL`）。伺服器模組在 `lib/line/*`，**沒有** `lib/line/index.ts`，避免覆蓋公開 URL。

---

## B. 新增與修改檔案

新增：

- `supabase/migrations/20261010120000_line_official_account_foundation.sql`
- `lib/line/*`（flag / roles / crypto / command / load / adapters / actions）
- `features/line/LineOfficialAccountSettings.tsx`
- `features/line/LineBroadcastCenter.tsx`
- `app/staff/(app)/settings/line/page.tsx`
- `app/staff/(app)/line/{layout,page}.tsx`
- `lib/line/line-official-account.isolation.test.ts`
- `docs/saas/line-official-account.md`

修改：

- Settings hub 入口卡、Owner 導航、schema-contract、migration chain、RBAC / IA 文件

---

## C. Supabase migration 設計

Organization-scoped tables：

| 表 | 內容 |
|----|------|
| `line_official_accounts` | Channel ID、token hint、測試狀態、店長群發開關。沒有密文。 |
| `line_official_account_secrets` | AES-256-GCM 密文。`revoke all`；不 grant SELECT 給 `authenticated`。 |
| `line_broadcasts` | 草稿 / 狀態 / `request_id`（`lbrq-%`）。`(organization_id, request_id)` unique。 |
| `line_broadcast_events` | 稽核。可沒有 `broadcast_id`（連線測試、開關）。 |

RLS：`user_is_org_owner(organization_id)` = active Owner membership **且** `user_has_org_membership(organizations.id)`。  
寫入走 SECURITY DEFINER RPC。`read_line_official_account_secrets` 不 grant 給 authenticated。

---

## D. LINE 串接流程

1. Owner 在設定頁輸入 Channel ID / Secret / Access Token。
2. Server Action 先決策，再以 `BEAUTY_OS_LINE_CREDENTIAL_KEY`（32-byte base64）加密。
3. RPC 只寫入密文與 hint。一般 SELECT 看不到 Secret / Token。
4. 「測試連線」由 Owner RPC 讀取 Access Token 密文（不回傳 Secret），伺服器解密後呼叫 `GET /v2/bot/info`。
5. 連線測試**不會**呼叫 Broadcast，也**不會**對好友寄送訊息。

Pilot：`BEAUTY_OS_LINE_CONNECTION_PILOT=1` 且已設定 Supabase URL / publishable key。未設則整個 UI fail-closed。

---

## E. 群發流程與權限

只支援官方帳號**全好友文字 Broadcast**。不顯示好友數或會員分群。

1. Owner 編輯文字、預覽、保存草稿（`request_id` 可追蹤）。
2. 確認發送時再次檢查：Owner、額度（每日 3）、重複 `request_id`、`pending_confirmation`。
3. 實際發送有雙重關閉：
   - 店長必須明確啟用 `broadcast_enabled`
   - 應用常數 `LINE_BROADCAST_SEND_OPEN = false`
4. Phase 1 confirm 只會留下 `send_closed`，**不呼叫** LINE Broadcast HTTP。
5. 未來若開放發送：成功只記 **API accepted**；timeout 記 `pending_confirmation`，**不自動重送**。使用 `X-Line-Retry-Key = request_id`。

頁面授權：`STAFF_LINE_ROLES = ["OWNER"]`。Manager 看得到設定、看不到 LINE 入口。

---

## F. 測試

`lib/line/line-official-account.isolation.test.ts` 覆蓋：

- flag / send 關閉
- Owner-only 與跨店拒絕
- 加解密與 hint
- 額度、冪等、timeout 不重送
- 連線測試走 `/v2/bot/info`
- migration 不 grant 密文、不建假分群
- Client UI 不引入 crypto / send / service role

另更新 migration chain 與 navigation isolation。

---

## G / H. 部署邊界

| 環境 | 允許 |
|------|------|
| Preview | 可套用 migration、可設 Preview env、可部署 Preview |
| Production | **不改** Supabase、**不改** env、**不部署** |

Production host 維持 `knccefcxncglgpmvgqlp.supabase.co`。
