# Appointment Domain

Phase 4.8A. Prototype store (localStorage). No Supabase.

## Entity

`ScheduleAppointment` (`lib/appointments/domain.ts`):

`organizationId` (required) · `locationId` (required) · customer / service / staff · `startAt` / `endAt` ISO · `durationMinutes` · canonical `status` · notes · audit fields (`createdBy`, `updatedAt`, optional `cancelledAt` / `statusReason`).

Legacy Today cards still receive a compatibility view (`time` + `pending | in_progress | completed`) from `getLiveAppointments`.

## Status lifecycle

`DRAFT → BOOKED → CONFIRMED → ARRIVED → IN_SERVICE → COMPLETED`

Terminal: `CANCELLED`, `NO_SHOW`

Transitions live in one table (`canTransition` / `assertTransition`). UI must not invent extra edges.

### Legacy compatibility

| Old | Canonical |
|-----|-----------|
| `pending` | `BOOKED` |
| `in_progress` | `IN_SERVICE` |
| `completed` | `COMPLETED` |

`normalizeAppointmentStatus()` is the only mapper. Seed rows that only have `HH:mm` are anchored to the viewed calendar day so Today keeps showing the demo board.

## Ownership

- List/get/create/update/transition all require `organizationId` (no active-org fallback).
- Location must belong to the organization.
- Customer, service, and staff membership must belong to the same organization.
- Staff `locationIds` must include the appointment location when restricted.

## Date/time

Canonical fields are `startAt` and `endAt`. Duration is derived. Service selection pre-fills end from `service.durationMinutes` (fallback `DEFAULT_SERVICE_DURATION_MINUTES`).

## Conflict foundation

`hasAppointmentConflict`: same staff, overlapping intervals. Adjacent end === next start is **not** a conflict. Cancelled / no-show ignored. UI warns and requires explicit override.

Phase **4.8B** wraps this inside `getStaffAvailability` with working hours, breaks, and time off. Create/update reject with reason-aware messages unless `allowConflict` is explicit.

## DRAFT availability

`DRAFT` appointments **occupy** availability (hold). Product choice documented for scheduling.

## Single source of truth

Calendar, Today (`listTodayAppointments`), Customer Detail appointment history (`AppointmentsTab`), and Appointment Detail all read the schedule store (`listAppointments` / overrides). Do not maintain a second mock appointment list for UI.

## Treatment

Appointment `IN_SERVICE` links into existing `/staff/treatments/new?appointment=`. Completing treatment may set appointment `COMPLETED` via the existing status bridge (`setAppointmentStatus` + `applyCompatibilityStatus`).

**Appointment COMPLETED ≠ paid.** Checkout / Transaction remains a separate domain.

## Storage

`beauty-os:{organizationId}:schedule-appointments:v1`

Legacy status overlay key remains for seed rows until an override is saved.

## Future Supabase

`appointments.organization_id` + `location_id` + `start_at` / `end_at` timestamptz. RLS by membership. This phase does not migrate SQL.
