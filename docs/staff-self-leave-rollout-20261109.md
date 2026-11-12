# 員工自主排休：開發驗收規格

## 已實作（僅開發分支）

- `lib/staff-schedule/self-leave-decision.ts`：純函式判斷員工自主排休；預設每天、全天最低 1 位美容師。
- 既有預約重疊或低於最低人力時回傳 `MANAGER_REVIEW`；無衝突回傳 `AUTO_APPROVE`。
- 伺服器資料快照未完整或輸入無效時回傳 `BLOCKED`，不允許自動核准。
- `self-leave-decision.test.ts`：覆蓋基本人力、時段缺口、既有預約、無效資料與快照不完整。

## 尚未實作，不可視為已上線

1. 店長可設定的資料表、權限與 UI（預設每天、全天最低 1 人；未設定時須有明確安全預設）。
2. 以已驗證員工身分提交的伺服器 API；員工僅能操作本人，店長可處理例外。
3. 在同一個資料庫交易內鎖定相關資源、重新查核排班、休息、請假、既有預約及最低人力，避免同時送出造成競態。
4. `AUTO_APPROVE` 寫入 `APPROVED`；`MANAGER_REVIEW` 寫入 `REQUESTED` 並立即封鎖新會員預約；拒絕時釋放封鎖。保留審核與異動紀錄。
5. 舊 `localStorage` 資料盤點及安全遷移、Supabase 權限/RLS 驗收、正式 Beauty OS 行事曆與會員網站同源讀取。
6. 在開發環境執行 `npm test -- lib/staff-schedule/self-leave-decision.test.ts`、型別檢查及跨帳號權限／競態／端到端測試。

**安全閘門：** 目前純函式不連接正式 UI、API 或資料庫，也沒有任何正式部署。不得只憑 Preview 建置成功就啟用自動核准。
