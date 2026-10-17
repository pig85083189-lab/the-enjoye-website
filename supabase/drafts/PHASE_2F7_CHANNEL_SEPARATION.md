# Phase 2F-7 official vs TEST LINE Channel split

Planning only. Option C from 2F-6. Does not create accounts, change Developers URLs, rotate secrets, deploy, or send.

## A. Owner 建立測試 LINE OA / Channel

只依畫面操作。本階段不實際新增或修改帳號。不要打開 Channel `2009219238` 的 Webhook / Token / Secret。

1. **建立獨立測試用 LINE 官方帳號**  
   https://manager.line.biz →「建立」→「建立官方帳號」。國家選台灣。名稱用測試名（例如 Beauty OS TEST）。搜尋／公開先關閉。不要使用既有 `ai` / THE ENJOYE。不要複製正式好友。

2. **啟用 Messaging API**  
   測試帳號 →「設定」→「Messaging API」→「啟用 Messaging API」。這會在 LINE Developers 建新 Channel。不要動正式 Channel。

3. **取得新的測試 Channel ID**  
   https://developers.line.biz/console/ 打開新 Channel。確認 ID 不是 `2009219238`。只回報後四碼。

4. **Preview 專用 Webhook（核准後）**  
   只在新 Channel 填 Preview + `/api/line/webhook/org-beauty-os-test/{publicToken}`。開啟 Use webhook 後 Verify。關閉自動回應與歡迎訊息。

5. **Preview 專用 Secret / Token**  
   只在測試 Channel 查看 Channel secret 與長期 Access Token。正式 Secret / Token 不輪替、不複製到 Preview、不貼到聊天。本階段不寫入遠端。

6. **驗證碼綁定與隔離（核准後）**  
   只用測試帳號加測試人員。Preview TEST 發 8 碼。確認正式 Channel 收不到該事件，正式 Broadcast 與好友名單不變。

## B. 正式 Channel 保留方案

保留：

- Channel `2009219238`（官方帳號 `ai` / `@357gospk`）
- THE ENJOYE 既有好友
- Production Broadcast 程式與設定
- Channel lock namespace `870121`
- 正式發送路徑（`LINE_BROADCAST_SHARED_CHANNEL_FORMAL_OWNERS` → `org-the-enjoye`）

本階段不改上述任何值。

## C. Preview TEST 切換清單

目前仍引用正式 Channel：

| 位置 | 現況 |
| --- | --- |
| `LINE_BROADCAST_ONESHOT_CHANNEL_ID` | `2009219238` |
| oneshot bot 名稱 / Basic ID | `ai` / `@357gospk` |
| oneshot SQL 身分檢查 | 同一組 Channel / bot |
| Channel lock `870121` | TEST 與 Enjoye 共用 |
| 正式 Developers Webhook | 仍在 Preview TEST 路徑（2F-3） |
| Preview webhook 簽章 | 用正式 Channel Secret |

切換完成條件（後續階段，不是現在）：

- 測試 Channel ID ≠ `2009219238`
- 測試 Webhook Verify 成功
- Preview `line_official_accounts` 改存測試 Channel
- oneshot 常數與 SQL 改認測試身分
- 正式 Channel Webhook 仍未改
- SEND 與正式驗證碼發行仍關閉

## D. 正式 Webhook 之後的安全切換順序

1. Preview TEST 已獨立，不再依賴 `2009219238`
2. 唯讀確認 Production Enjoye public token（不輪替、不複製）
3. 唯讀確認 Production 加密金鑰對得上既有密文（不輪替）
4. 正式網站核對 2F-4 畫面的 Owner operational staff id
5. **另一次核准**後，才把 Channel `2009219238` Webhook 改到  
   `https://the-enjoye-website.vercel.app/api/line/webhook/org-the-enjoye/{publicToken}`
6. 只做 LINE 官方 Verify。SEND 與 `ENJOYE_OWNER_BIND_*` 仍關閉，直到再一次核准

測試 Channel 建立完成，不得打開正式綁定或發送。

## E. 回復方案

- 測試帳號失敗：捨棄測試 Channel。正式 Channel 不動。
- 誤改正式 Webhook：改回舊 Preview 別名與原路徑，按 Verify。不輪替 Token / Secret。
- 不要互拷好友、驗證碼、`webhook_events`、recipients。
- 回復後重發驗證碼。不要重放舊碼，不要用 Push / Broadcast 補事件。

## F. BLOCKER

- 測試 OA / Channel 尚未建立
- `PREVIEW_TEST_CHANNEL_ID` 未指派
- Preview oneshot / SQL 仍硬編碼正式 Channel
- 正式 Webhook 仍在 Preview TEST
- Production public token / 加密金鑰 / Owner staff id 尚未唯讀確認
- 正式綁定與 SEND 必須維持關閉

## G. 下一步需要 Owner 核准的實際動作

1. 依 A 建立測試官方帳號並啟用 Messaging API（不要改 `2009219238`）
2. 只回報新測試 Channel ID 後四碼
3. 回報測試 Channel Webhook 尚未填，或只填 Preview TEST 且正式 Channel 未改
4. 在以上完成並另一次核准前，不要把正式 Webhook 改到 Production，也不要開 SEND
