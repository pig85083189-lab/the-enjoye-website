# Core Business Flow — Manual QA

Phase 4.9C. Run after major commerce / calendar / treatment changes.

Prerequisites: staff login, org **THE ENJOYE**, location switcher available (主店 / 公益店).

---

## Scenario A — 新客 → 預約 → 療程 → 現金結帳

| Step | Action | Expected |
|------|--------|----------|
| 1 | 建立客戶「王小美」 | Customer Detail 顯示正確 org |
| 2 | Calendar 新增預約：性感美胸、怡蓁、10:00–11:30、主店 | Calendar / Today / 客戶預約 tab 同一筆 |
| 3 | 確認 → 已到 → 開始服務 | Status IN_SERVICE；進 Treatment |
| 4 | 完成療程 | Appointment COMPLETED；**尚未**出現「已結帳」 |
| 5 | 前往結帳 → 現金付清 | 一筆 Transaction；金額 = 服務價；客戶交易紀錄可見 |
| 6 | 再按完成結帳 | 不產生第二筆 Transaction |

---

## Scenario B — 買 10 堂 → 用 1 堂 → 剩 9

| Step | Action | Expected |
|------|--------|----------|
| 1 | 客戶錢包 → 購買「美胸保養 10 堂」→ 刷卡結帳 | Transaction + Wallet 剩餘 10 |
| 2 | OPEN draft 勾選「使用套票」 | 餘額仍 10 |
| 3 | 完成結帳（應付 0） | 餘額 9；Transaction total 0；無付款列亦可 |

---

## Scenario C — 跨分店再用 1 堂 → 剩 8

| Step | Action | Expected |
|------|--------|----------|
| 1 | 切換至公益店，建立同客美胸預約並完成療程 | Appointment location = 公益店 |
| 2 | 結帳使用同一套票 | 餘額 8；Ledger 核銷 location = 公益店；購買紀錄仍主店 |

---

## Scenario D — 儲值 10000 → 消費服務價 → 餘額減少

| Step | Action | Expected |
|------|--------|----------|
| 1 | 錢包儲值 10000 → 刷卡完成 | OPEN 時餘額 0；完成後 10000 |
| 2 | 服務結帳全額儲值金 | Ledger PAYMENT；餘額 = 10000 − 服務價 |

---

## Scenario E — Mixed tender

| Step | Action | Expected |
|------|--------|----------|
| 1 | 應付 3000：儲值 2000 + 現金 1000 | Transaction payments 兩筆；儲值再扣 2000 |
| 2 | 重複完成 | 不再扣款 |

---

## Scenario F — Tenant switch isolation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Enjoye 錢包/交易有資料 | 可見 |
| 2 | 切換 LUMIÈRE | 不得短暫顯示 Enjoye 客戶/交易/套票；僅見該 org 資料 |
| 3 | 切回 Enjoye | 資料恢復一致 |

---

## Smoke — responsive

Desktop / ~1280 / Tablet / Mobile：Calendar、Treatment、Checkout、Wallet、Transaction Detail 無嚴重橫向溢出、sticky CTA 不擋表單、bottom nav 不遮操作。
