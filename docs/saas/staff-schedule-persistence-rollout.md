# Staff schedule persistence rollout plan

## Confirmed current behavior
`lib/staff-schedule/store.ts` stores working hours, breaks and leave in browser `localStorage`. `getStaffAvailability` consumes those browser-local records and default hours. This cannot serve as an authoritative server-side online booking calendar.

## Stage A: schema review (current)
Draft-only SQL: `supabase/migrations/DRAFT_20261031_staff_schedule_persistence.sql`. No database migration applied. The draft uses UUID tenant and location IDs, legacy text staff IDs, RLS enabled with no public policies. It intentionally does not imply online booking readiness.

## Stage B: identity reconciliation before any import
Verify `staffId` in browser schedule against `staff_auth_memberships.user_id` and existing appointments `staff_id`. Verify organization and location memberships. Reject missing, ambiguous, or cross-tenant IDs. Do not create placeholder staff identities.

## Stage C: safe migration
Use a dedicated test database or isolated test tenant, not the current live THE ENJOYE records. Back up schedule records from the source browser(s) only with operator consent. Build a reviewed, idempotent import with tenant/location validation, row-count comparison, and rollback plan. Do not overwrite existing schedule data.

## Stage D: single authoritative source
Introduce server-side schedule repository and role-checked staff CRUD endpoints. Update Beauty OS staff scheduling UI to use this repository; only after read/write acceptance, remove localStorage as authority. Treat unknown schedules as unavailable.

## Stage E: booking engine
Implement tenant-scoped availability API using persisted hours, breaks, approved leave, service duration, staff capability and existing appointments. Revalidate in one transaction on booking creation with idempotency and concurrency protection. Customer creation, LINE Login customer link and appointment must commit or roll back together.

## Acceptance gates
- Different browsers see the same staff schedule and edits.
- Cross-tenant schedule access denied.
- Approved leave and breaks remove available slots.
- Missing schedule returns no bookable slots.
- Two concurrent requests for one staff slot cannot both succeed.
- Member session can only see its own verified customer appointments.
- Production stays unchanged until explicit release approval.
