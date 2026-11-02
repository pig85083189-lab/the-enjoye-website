# Beauty OS 休假資料表上線前檢查

目前正式專案 `knccefcxncglgpmvgqlp` 尚無 `public.booking_staff_time_off`（2026-11-02 唯讀查詢確認）。

## 遷移順序

1. 先確認正式預約寫入來源，以及文字組織／分店 ID 與 UUID 預約資料的對應，不能依名稱猜測。
2. 審核 `supabase/booking_staff_time_off_v1.sql` 的權限、RLS、欄位及現有系統相容性。
3. 在測試環境套用 v1，確認服務端 GET、POST、PATCH REJECT 與跨租戶隔離測試。
4. 在套用 v2 前，先執行下方重疊資料唯讀檢查。必須沒有結果，才能建立排他限制。
5. 套用 `supabase/booking_staff_time_off_overlap_guard_v2.sql`，測試並行提交與相鄰時間邊界。
6. 先驗證預約衝突檢查與核准後預約封鎖，再另行開放 APPROVE。不得直接解除 API 的 409 安全閘門。

## v2 上線前唯讀檢查

```sql
select a.id as first_id, b.id as second_id,
       a.organization_id, a.location_id, a.staff_id
from public.booking_staff_time_off a
join public.booking_staff_time_off b
  on a.organization_id = b.organization_id
 and a.location_id = b.location_id
 and a.staff_id = b.staff_id
 and a.id < b.id
 and tstzrange(a.start_at, a.end_at, '[)')
     && tstzrange(b.start_at, b.end_at, '[)')
where a.status in ('REQUESTED', 'APPROVED')
  and b.status in ('REQUESTED', 'APPROVED')
limit 100;
```

若查出任何紀錄，先人工核對並處理，不要自動刪除或覆寫。

## 注意事項

- v1 尚未正式套用，v2 不能單獨執行。
- 目前 API 的查詢再插入並非原子操作；正式防併發需依賴 v2 資料庫排他限制。
- 正式部署前須確認 `btree_gist` 擴充可建立於 `extensions` schema，並在測試環境實際驗證。
- 正式預約 tenant mapping 未驗證前，休假核准仍必須回傳 `APPOINTMENT_SCOPE_UNVERIFIED`。
