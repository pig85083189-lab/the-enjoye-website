# Leave approval: appointment tenant mapping verification

Status: BLOCKED (2026-11-02). Do not enable approval or booking-slot blocking based on an assumed mapping.

## Verified production schema (metadata only)

- `public.appointments.organization_id`: UUID, foreign-key relationship to `organizations.id`.
- `public.appointments.location_id`: UUID, foreign-key relationship to `locations`.
- `public.appointments.staff_id`: text.
- `public.booking_staff_working_hours.organization_id` and `.location_id`: text.
- `public.staff_auth_memberships.organization_id`: text.
- `public.staff_auth_membership_locations.location_id`: text.
- No validated mapping between the text tenant/location identifiers and UUID tenant/location identifiers has been established.

## Approval gate

1. Trace the exact booking creation endpoint and verify which database table receives live member appointments.
2. Establish an explicit, authenticated mapping between the text organization/location and UUID organization/location, if they represent the same tenant. Never infer from display names, slugs, or row counts.
3. Verify that the booking staff identifier corresponds to the authenticated staff membership and that all relevant appointment statuses and overlapping time ranges are included.
4. Run read-only, scoped conflict checks against known non-sensitive test bookings, including canceled, adjacent, and overlapping appointments. A zero-row response alone does not prove mapping.
5. Require a complete, successful query; on missing mapping, query error, or truncated results, fail closed.
6. Re-check conflicts at the moment of approval; protect against concurrent booking writes before making approval and booking-slot exclusion available.
7. Verify approved leave blocks availability in the actual member booking path, not just the staff calendar.
8. Test roles, tenant isolation, repeated review, and mobile/desktop consistency before migration and production deployment.

Current API: `PATCH /api/staff/time-off` rejects `APPROVE` with `APPOINTMENT_SCOPE_UNVERIFIED` (409). Keep this guard until the above is verified.

No production records or schema were changed during this investigation.
