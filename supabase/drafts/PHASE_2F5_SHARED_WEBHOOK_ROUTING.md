# Phase 2F-5 shared LINE webhook routing

Local prototype only. Developers URL, remote SQL, and send flags are unchanged.

## A. 現有架構限制

1. Signature is verified in `processLineWebhookBind` after the URL org + public token loads that org’s Channel Secret ciphertext.
2. Owner `start_line_owner_bind_challenge` stores `sha256(orgId:CODE)` plus `staff_user_id` on **that environment’s** database.
3. Consume uses **URL `organizationId`**, not a channel-wide challenge lookup. LINE Channel `2009219238` has one Developers URL, currently Preview + `org-beauty-os-test`.
4. Production `knccefcxncglgpmvgqlp` and Preview `bfzquejrtgqzzarhkiya` are separate. Challenges, tokens, recipients, and `webhook_events` do not transfer.
5. Dedup is `(organization_id, event_id)`. The same LINE `webhookEventId` could be retried under another org path.
6. A shared Channel does not label events with Beauty OS org. The current path org is not a trusted shop identifier.

## B. A / B 比較

| | A 中立 Gateway | B 受限轉送 |
| --- | --- | --- |
| 簽章 | Gateway 用 Channel Secret 驗一次 | Preview 驗 TEST；轉送後 Production 必須重驗 |
| 路由 | 依 challenge 歸屬，不依 URL org | Preview 只 consume TEST；未命中才轉 Enjoye |
| 憑證隔離 | Gateway 不可持有任一邊 service_role / 加密金鑰 | Preview 不可持有 Production service_role / 金鑰 |
| 跨庫 | 禁止任意 join；若雙庫都要活，只能各打一次受限 RPC | Preview 不查 Production 表，只轉原始 body + signature |
| TEST | 兩庫分離時 Gateway 無法同時看見 TEST 與 Enjoye | 可保留現有 TEST consume |
| 維護 | 新主機、新密鑰箱、雙 RPC | 沿用現有 Preview 別名，加 Production 重驗入口 |
| SaaS | 同一 Production DB 多店時較乾淨 | 過渡方案；正式多店應再收斂到單一 DB + A |

不得假設共用 Channel 能天然分店。相同 8 碼同時開在兩店必須碰撞拒絕。

## C. 推薦

**先用 B（受限轉送）**，長期再收斂到 A。

原因：現在 Developers URL 仍在 Preview TEST 路徑，且兩套資料庫分離。B 能保留 TEST，又讓 Production 只處理 Enjoye，且 Production 自行重驗簽章。A 在不合併資料庫、不給跨庫金鑰的前提下，做不到「同時看見」兩邊 challenge。

## D. 原型檔案

- `lib/line/webhook-routing/shared-channel-router.ts`
- `lib/line/webhook-routing/shared-channel-router.isolation.test.ts`
- this file

Not wired to `app/api/line/webhook/...`. Not connected to a real URL.

## E. 本機測試

Isolation covers correct org routing, URL-org mismatch, same-code collision, replay, bad signature, unknown event, database down fail-closed, flags closed.

## F. 既有 TEST

原型把 Preview DB 限於 `org-beauty-os-test`，Production DB 限於 `org-the-enjoye`。B 可保留 TEST。不要複製 Preview 綁定到 Production。

## G. 最小正式整合順序

1. Owner 核准架構 B（本階段不改 Developers URL）。
2. Production 只加「重驗簽章 + Enjoye-only consume」入口；Preview 未命中 TEST challenge 才轉送。
3. 正式 Enjoye 綁定啟動仍先保持關閉，直到轉送與重驗通過本機／Preview 安全演練。
4. 不要輪替 Channel Token / Secret。不要開 SEND。
5. TEST 退役或遷到 Production DB 後，再評估改 A 與改 Developers URL。

## H. 仍存在的 BLOCKER

- Developers URL 仍是 Preview + TEST 路徑
- Production Enjoye public token / 加密金鑰尚未唯讀確認
- 正式轉送入口尚未部署（本階段禁止部署）
- Enjoye 產生驗證碼仍關閉（2F-4）
- 8 碼在 10 分鐘內雙店同時發行仍可能碰撞（原型已拒絕）
- 不得把此原型接到任何真實 Webhook URL
