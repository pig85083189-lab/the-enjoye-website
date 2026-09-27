# Core Ops UX Completion

**Phase 4.11B** · Staff App daily-ops surfaces  
**Prerequisite:** Phase 4.11A productization audit (accepted) · Core v0.2

This phase does **not** add large new business domains. It closes P1 Staff UX gaps where underlying stores already existed.

---

## Scope delivered

| Area | Change |
|------|--------|
| **Today → Checkout** | Eligible appointments show「前往結帳」; COMPLETED TX shows「查看交易」; VOIDED follows `hasCompletedTransactionForAppointment` |
| **Treatments index** | Real list + draft inbox (no ModulePlaceholder) |
| **Customer edit** | `/staff/customers/[id]/edit` via `localCustomerRepository.updateProfile` |
| **Appointment path** | Today maps `listTodayAppointments` → card view; Treatment still uses legacy adapter |
| **Staff nav** | status `ready` · description「員工與排班」 |
| **Treatments nav** | status `ready` · draft inbox description |

---

## Paid truth

- Never `appointment.isPaid` / `treatment.isPaid`
- Checkout CTA uses `lib/commerce/appointment-checkout-nav.ts` → COMPLETED Transaction only
- Eligibility statuses: `IN_SERVICE` \| `COMPLETED` (`CHECKOUT_ELIGIBLE_APPOINTMENT_STATUSES`)

---

## Treatments list data sources

| Kind | API |
|------|-----|
| Open drafts | `listOpenTreatmentDrafts(organizationId)` |
| Completed | `listCompletedTreatmentsForOrganization` (seed + stored) |
| Resume draft | `/staff/treatments/new?customer=&appointment=` |
| View completed | `/staff/treatments/[id]` |

Location: if Treatment has no `locationId`, it remains visible under any location filter (optional location invariant unchanged).

---

## Remaining legacy `appointment-store` usage

| Consumer | Why retained |
|----------|----------------|
| Treatment workspace | `setAppointmentStatus` / `getAppointmentById` compatibility |
| Customer profile / Appointments tab | `findAppointmentForCustomer` |
| Calendar (partial) | subscribe + status helpers |
| Today | **subscribe only** + `scheduleAppointmentToLegacyView` mapper — listing is canonical |

---

## Non-goals (still out of scope)

Follow-ups · Reports · Supabase · Auth · RLS · Notifications · Inventory transfer · Refund · Customer App · Platform Admin · full RBAC editor
