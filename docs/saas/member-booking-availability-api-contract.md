# Member booking availability API contract (design only)

**Status:** not implemented, not deployed, no database changes.

## Request (authenticated server-to-server only)
`POST /api/internal/member-booking/availability`
- organizationId: server-resolved UUID (never trust a client-supplied tenant)
- locationId: validated UUID belonging to organization
- serviceId: active tenant-owned service UUID
- date: YYYY-MM-DD in Asia/Taipei
- staffSelection: verified operational staff ID, or `auto`
- Never accept arbitrary member-provided staff IDs as authoritative.

## Server prerequisites
1. Resolve authenticated member session and tenant, validate staff role/bookability, service capability and location.
2. Read **complete** persisted working hours, breaks, approved leave, and all overlapping appointments from one authoritative source. Treat read errors, missing coverage or stale snapshots as unavailable. Browser localStorage and seed schedules are not authoritative.
3. For each candidate, call `checkBookingSlot` with `scheduleSnapshotComplete: true` **only after** the repository verifies full coverage. Never set true by default.
4. `auto` should choose only among verified staff in the same tenant/location who can perform the selected service.
5. Return candidate start times and display labels only. Do not return internal customer names, other customers' appointments, staff auth IDs or service keys.

## Booking submission
`POST /api/internal/member-booking/confirm` requires signed LINE member session, CSRF protection, one-time idempotency key, service/location/staff selection and chosen start. Recheck availability inside a transaction with a database concurrency guard; insert LINE customer link, customer and appointment atomically. A read-only availability response is not a reservation or hold.

## Release gates
- Confirm THE ENJOYE staff operational identity mapping from actual account, not demo seed. The two visible choices are 測試帳號 and 宜欣; neither is currently a verified persisted bookable staff record.
- Persist schedule in a reviewed migration and test against isolated test tenant.
- Validate overlapping concurrent requests, cross-tenant access, session expiry, missing feed, breaks, leave and cancellations.
- Keep booking confirmation disabled until all gates pass.

## Data safety
Beauty OS Supabase is currently shared with live operations. Do not apply schema or write test appointments without explicit approval.
