# Staff Scheduling

Phase 4.8B. Prototype localStorage. No Supabase.

## Entities

### StaffWorkingHours

`organizationId` · `locationId` · `staffId` · `dayOfWeek` (0=Sun) · `startTime` / `endTime` (HH:mm) · `isWorking`

Separate from `StaffMembership`. Defaults seed Mon–Sat to calendar business hours (`09:00–21:00`), Sunday off, on first read per staff/location.

### StaffBreak

One-off break: `startAt` / `endAt` ISO · optional `label`. Recurring breaks are **future**.

### StaffTimeOff

`startAt` / `endAt` · optional `reason` · `status` (`APPROVED` prototype; `REQUESTED` / `REJECTED` reserved). No approval workflow UI in 4.8B.

## Location relationship

Hours / breaks / time off are **location-scoped**. A staff member may have different hours per location later; prototype validates location ∈ organization and staff membership can operate that location.

## Tenant ownership

All APIs require explicit `organizationId`. Cross-org location/staff writes fail closed. Storage keys are tenant-aware:

| Resource | Key |
|----------|-----|
| Working hours | `beauty-os:{orgId}:staff-working-hours:v1` |
| Breaks | `beauty-os:{orgId}:staff-breaks:v1` |
| Time off | `beauty-os:{orgId}:staff-time-off:v1` |
| Calendar view prefs | `beauty-os:{orgId}:calendar-view-prefs:v1` |

## Capability

`canReceiveAppointments(membership)` — prototype: active membership. Future permission / `StaffServiceCapability` (staff × service) is documented but not enforced (all bookable staff can run all services).

## Management UI

`/staff/staff` — pick staff, edit weekly hours, add/delete breaks and time off for the current location.

## Future Supabase

`staff_working_hours` · `staff_breaks` · `staff_time_off` with `organization_id` + `location_id` RLS. Separate from `location_business_hours`.
