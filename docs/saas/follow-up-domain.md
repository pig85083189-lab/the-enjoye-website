# Follow-up CRM Domain

**Phase 4.11C** · Staff Follow-ups Workspace  
**Prerequisite:** Phase 4.11B Core Ops UX · Treatment Workspace FollowUp step

## Core idea

```text
Treatment.followUp (clinical intent on the treatment record)
  → FollowUpTask (operable CRM work item)
  → Staff Workspace (due / overdue / complete / snooze / rebook)
  → Appointment (rebook via Calendar create — not the follow-up itself)
```

**Follow-up ≠ Appointment.** Completing a follow-up does not book a visit;「再次預約」opens the existing Calendar create flow with customer (and optional service/staff) prefilled.

---

## Models

### TreatmentFollowUp (existing — clinical)

On `TreatmentDraft.followUp`:

- `tags`, `suggestedDate`, `note`, `suggestNextBooking`

### FollowUpTask (canonical CRM)

| Field | Notes |
|-------|--------|
| `id` | Deterministic `fu-treatment-{treatmentId}` when sourced from Treatment |
| `organizationId` | Required |
| `locationId?` | Source activity location; optional (org-wide CRM) |
| `customerId` | Required |
| `sourceTreatmentId` | Idempotency linkage |
| `assignedStaffId?` | Same-org membership; else unassigned |
| `dueAt` | ISO; from `suggestedDate` @ 10:00 local, else +7 days |
| `status` | `OPEN` \| `COMPLETED` |
| `type` | `TREATMENT_FOLLOW_UP` \| `REBOOKING` (if suggestNextBooking) |
| `context` | Minimal snapshot (names, tags) — not a full Treatment copy |

**Snooze decision:** keep `OPEN` and update `dueAt` (no `SNOOZED` status).

---

## Storage

`beauty-os:{organizationId}:follow-up-tasks:v1`

Features must not touch localStorage; use `lib/follow-ups/store.ts`.

Timezone: prototype uses **browser local** calendar day (no Organization timezone yet).

---

## Idempotency

`ensureFollowUpTaskFromCompletedTreatment` runs from `saveCompletedTreatment`.

Same `sourceTreatmentId` / deterministic id → return existing task; never duplicate on refresh / re-complete.

---

## Selectors

Pure helpers in `lib/follow-ups/selectors.ts`:

- Due today · Overdue (before local start of today) · Upcoming · Completed · Open

---

## Non-goals

Marketing automation · LINE / Email / SMS · AI follow-up · Notifications push
