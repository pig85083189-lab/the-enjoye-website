# THE ENJOYE staff identity reconciliation (read-only findings)

## Sources checked
- `data/seed-organizations.ts`: THE ENJOYE seed memberships include `staff-001` (OWNER, demo account), `staff-002` (小美), `staff-003` (Amy), `staff-004` (安安).
- `lib/staff-auth/membership-query.ts`: canonical runtime membership view merges seed, browser localStorage overlays, and remotely hydrated memberships; remote membership presence changes canonical selection.
- `lib/staff-schedule/store.ts`: working hours, breaks and time off are browser localStorage.
- Beauty OS Supabase read-only inspection on 2026-10-31: THE ENJOYE has 1 location, 7 appointment rows, 0 persisted staff_auth_memberships rows. All 7 appointments reference `staff-001`.

## Consequences
`staff-001` is a demo OWNER identity in source, **not a verified bookable therapist**. It must not be auto-mapped to a real employee or used to publish availability. Staff IDs are text, while auth IDs are UUIDs and membership organization_id is text; these are distinct fields, not interchangeable.

## Before enabling online booking
1. Define which actual THE ENJOYE staff are bookable and confirm their operational staff IDs with the owner.
2. Build an explicit, reviewable staff identity mapping (organization UUID, location UUID, operational staff ID, membership ID, auth user ID where applicable). Never match by display name alone.
3. Backfill only approved memberships and location associations using an idempotent migration with rollback. Preserve existing appointment staff IDs until explicitly reconciled.
4. Persist working hours, breaks and approved leave in shared backend storage. Reject unknown schedule as unavailable.
5. Validate service capability, overlap prevention, transactionality and tenant boundaries before opening member booking.

## Safety
No database rows were created, updated, or deleted during this inspection. Production and member booking remain unchanged.
