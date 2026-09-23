# Availability Engine

Phase 4.8B. Centralized in `lib/staff-schedule/availability.ts`.

## Inputs

`getStaffAvailability({ organizationId, locationId, staffId, startAt, endAt, appointments, ignoreAppointmentId?, serviceId? })`

Callers pass `appointments` (from the shared appointment store) to keep the engine free of circular imports and UI-specific data loads.

## Reason codes

| Code | Meaning |
|------|---------|
| `OUTSIDE_WORKING_HOURS` | Off day or outside `startTime`–`endTime` |
| `BREAK` | Overlaps a one-off break |
| `TIME_OFF` | Overlaps approved time off |
| `APPOINTMENT_CONFLICT` | Overlaps a blocking appointment |
| `STAFF_NOT_FOUND` | No active membership in org |
| `LOCATION_DENIED` | Staff cannot operate location |
| `NOT_BOOKABLE` | Capability adapter rejected |

Result shape: `{ available, reasons[], details[], conflictingAppointmentId? }`.

## Status blocking rules

| Status | Blocks availability? |
|--------|----------------------|
| `DRAFT` | Yes (hold) |
| `BOOKED` | Yes |
| `CONFIRMED` | Yes |
| `ARRIVED` | Yes |
| `IN_SERVICE` | Yes |
| `COMPLETED` | Yes for overlapping window (historical) |
| `CANCELLED` | No |
| `NO_SHOW` | No |

Adjacent intervals (`end === next start`) are **not** conflicts (same as 4.8A).

## Working hours / break / time off

Evaluated in that order alongside appointment overlap. Details are human-readable (staff name + times).

## Override

Create/Edit may pass `allowConflict: true` after an explicit UI action（「仍要建立預約」）. Prototype does not persist `overrideReason` / `overrideBy` yet — reserved for audit.

## findAvailableStaff

Lists bookable staff at the location whose availability is free for the interval. Used by Create Appointment 「可預約美容師」.

## Future resources

Engine must not assume staff-only forever. Documented types: `Resource` (`ROOM` | `BED` | `EQUIPMENT`), `AppointmentResource`. Not runtime in 4.8B.
