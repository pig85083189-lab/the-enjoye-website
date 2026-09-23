# Calendar UX

Phase 4.8A + **4.8B Staff Day View**. Route: `/staff/calendar`. `/staff/appointments` redirects here.

## Desktop

- **Week** (default, remembered per org in localStorage): date columns, 30-minute grid, appointment height = duration.
- **Day** = **Staff Schedule View**: X = bookable staff (current org + location), Y = time. Working hours muted outside range; breaks / time off labeled; appointments positioned by `startAt`/`endAt`.
- Click empty staff/time slot → Create with staff + date + start prefilled.
- Staff filter (view-only; does not mutate store).
- Primary action: 新增預約.

## Tablet

Staff Day columns horizontally scroll; time axis stays readable (`minmax(140px)`). Week remains scrollable.

## Mobile

Day agenda + date strip + staff filter. No multi-column staff grid. Sticky 新增預約. Touch ≥ 44px.

## Create / Edit

Live availability (`getStaffAvailability`) with reason text. 「可預約美容師」 from `findAvailableStaff`. Explicit override required when unavailable. Service duration still autofills `endAt`.

## Detail

Unchanged from 4.8A — single Appointment Detail for Week/Day/Mobile.

## Empty

「今天還沒有預約」 / 「此分店目前沒有可排班美容師」.

## Accessibility

Staff headers labeled; empty-slot buttons have aria-labels; status text (not color-only); dialogs Esc + focus trap.

## Separation

Location business hours (calendar config) ≠ Staff working hours. Room/bed booking deferred.

## Visual polish (4.8B.1)

- Visible-range layout: appointments fully outside 09:00–21:00 are hidden (not clamped to header).
- Staff Day fills shell content width (1–4 staff); horizontal scroll only when more columns.
- Calendar body uses viewport-capped height + thin scrollbar; sticky staff/day headers.
- Appointment cards: time + customer → service → compact status text; Day view omits staff name.
