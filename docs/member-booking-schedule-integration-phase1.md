# Beauty OS × THE ENJOYE 會員預約：第一階段串接契約

## 已確認的現況（2026-11-02）

- 排班專案：`pig85083189-lab/the-enjoye-website`，開發分支 `feature/staff-leave-approval-ui-20261102`。
- 會員專案：`pig85083189-lab/the-enjoye-member`，`main` 的 `app/page.tsx` 仍顯示 LINE 登入未開放；已檢查常見 `app/api/appointments` 與 `app/api/bookings` 路徑，未找到對應端點。
- 排班 API：`GET /api/staff/working-hours?locationId=...` 僅供登入的員工及所屬分店讀取，`PATCH` 僅 OWNER/MANAGER 可修改，不能直接給未登入會員使用。
- 目前排班使用文字 organization/location/staff ID；既有 `public.appointments` 的 organization/location 是 UUID。正式資料庫 schema 已確認 `organizations.app_id text` 與 `locations.app_id text`，可作為文字 ID → UUID 的候選映射欄位；但仍需確認實際映射唯一性、正確性與正式預約寫入來源。

## 先交付的最小功能

1. 店長可在 Beauty OS 調整美容師每週上班日、開始及結束時間，儲存至 `booking_staff_working_hours`。
2. 會員預約頁只顯示可預約的美容師、日期及時段，不得暴露內部排班管理 API 或 service role key。
3. 會員提交預約必須經過**伺服器端**二次檢查，確認美容師、分店、時段、現有預約衝突及當前休假／封鎖時段。
4. 成功建立預約後，Beauty OS 行事曆和會員中心應讀取**同一個正式預約來源**，不得各自儲存互不相通的預約。

## 會員公開查詢介面（待實作，非現有 API）

- `GET /api/member-booking/availability?locationId=<public-location-key>&serviceId=<id>&date=YYYY-MM-DD`
- 回傳僅公開顯示資訊：美容師公開名稱、可選時段、服務資訊；不回傳 staff_auth_memberships、員工 email、私人備註或租戶內部識別資訊。
- 預約寫入須使用會員已驗證的 session 與防重複提交 token；若 LINE 登入尚未完成，先保留安全的不可提交狀態。

## 上線前必須先釐清

- 正式預約究竟由哪個服務寫入、哪個資料表是唯一來源。
- 已確認 `organizations.app_id`、`locations.app_id` 存在；查詢時必須要求各自恰好一筆，且 `locations.organization_id = organizations.id`，不得只靠名稱或忽略多筆結果。
- 美容師 staff ID 與正式預約 staff_id 是否同一身份。
- 會員身份如何綁定既有顧客資料，不可直接信任瀏覽器提供的 customer_id。
- 可預約時段須納入工作時間、既有預約、休息時間、核准休假及服務時長。
- 先在 Preview 和測試資料庫完成端到端測試，再考慮正式部署。

## 安全限制

在正式預約來源與身份映射未確認前，不開放會員寫入預約、不對外公開管理員排班端點、不解除休假 APPROVE 的 409 安全閘門。

## 2026-11-02 補充：既有休假 API

開發分支另有 `app/api/staff/leave-requests/route.ts`、`[id]/route.ts`、`[id]/conflicts/route.ts`，使用 `staff_leave_requests` 表。衝突端點已示範以 `organizations.app_id`、`locations.app_id` 對應 UUID，再查 `appointments`。這與新增的 `booking_staff_time_off` 是兩套不同的休假來源，正式整合前必須決定單一權威來源，避免雙重休假狀態與重複封鎖。該端點仍將 `approvalEnabled` 固定為 false，不可據此宣稱核准已安全啟用。

## 2026-11-02 正式資料庫唯讀驗證與休假表建立

- 已套用 `booking_staff_time_off_v1` migration，`public.booking_staff_time_off` 已存在，查詢確認目前 0 筆資料；RLS 已啟用，`anon` 與 `authenticated` 無直接 SELECT 權限。此操作只建立資料結構，未建立測試休假紀錄。
- `booking_staff_working_hours` 目前 14 筆：`staff-001` 與 `staff-muy4glz6-0g09f4` 各有 7 筆不同星期資料，分店皆為 `loc-enjoye-main`。
- `organizations.app_id='org-the-enjoye'` 與 `locations.app_id='loc-enjoye-main'` 的 UUID 關聯實際查詢僅有 1 筆符合。
- 同一組組織與分店下，正式 `appointments` 有 7 筆，全部為 `BOOKED`，其 `staff_id` 均為 `staff-001`，與排班的 staff ID 一致。此結果只涵蓋查詢當下的資料，不代表其他狀態或未來預約都已驗證。
- `app/api/staff/time-off/route.ts` 的 POST 只新增 `REQUESTED`，PATCH 的 `APPROVE` 仍固定回覆 409；不可因資料表已建立而解除安全閘門。
- **仍待完成**：兩套休假來源統一、核准時的正式預約衝突檢查及併發保護、休息時間資料來源、會員身份驗證與原子預約寫入、實際測試通過紀錄。正式會員預約不可開放。
