# Beauty OS × THE ENJOYE 會員預約：第一階段串接契約

## 已確認的現況（2026-11-02）

- 排班專案：`pig85083189-lab/the-enjoye-website`，開發分支 `feature/staff-leave-approval-ui-20261102`。
- 會員專案：`pig85083189-lab/the-enjoye-member`，`main` 的 `app/page.tsx` 仍顯示 LINE 登入未開放；已檢查常見 `app/api/appointments` 與 `app/api/bookings` 路徑，未找到對應端點。
- 排班 API：`GET /api/staff/working-hours?locationId=...` 僅供登入的員工及所屬分店讀取，`PATCH` 僅 OWNER/MANAGER 可修改，不能直接給未登入會員使用。
- 目前排班使用文字 organization/location/staff ID；既有 `public.appointments` 的 organization/location 是 UUID。尚未驗證對應，不能直接 JOIN 或假定預約來源。

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
- 文字 org/location ID 如何可靠映射到 UUID org/location ID，必須有明確資料表或設定，不依顯示名稱猜測。
- 美容師 staff ID 與正式預約 staff_id 是否同一身份。
- 會員身份如何綁定既有顧客資料，不可直接信任瀏覽器提供的 customer_id。
- 可預約時段須納入工作時間、既有預約、休息時間、核准休假及服務時長。
- 先在 Preview 和測試資料庫完成端到端測試，再考慮正式部署。

## 安全限制

在正式預約來源與身份映射未確認前，不開放會員寫入預約、不對外公開管理員排班端點、不解除休假 APPROVE 的 409 安全閘門。
