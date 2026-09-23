# Core Business Lifecycle

Phase 4.6. Defines the operational closed loop and recommended future status models.

```text
Customer
  → Appointment
  → Check-in
  → Consultation (as needed)
  → Treatment
  → Checkout
  → Package / Stored Value deduction
  → Follow Up
  → Rebooking
```

---

## End-to-end stage table

| Stage | Input | Output | Key entities | Must not re-create | Audit |
|-------|-------|--------|--------------|--------------------|-------|
| **Customer** | Phone/name/source | Customer record | Customer, Tags | Duplicate phone without confirm | create/update actor |
| **Appointment** | Customer + Service + Location + time | Booked visit | Appointment | Duplicate slot double-book (policy) | status history |
| **Check-in** | Arrived guest | ARRIVED status | Appointment | New appointment | timestamp + staff |
| **Consultation** | New / update form | Consultation version | CustomerConsultation | Overwrite prior consultation | consultedBy, confirmedAt |
| **Treatment** | Appointment + Customer + Service | Completed treatment | Treatment (+ steps) | Fake “new” treatment for same open appointment | staff, completedAt |
| **Checkout** | Cart lines + tenders | Transaction settled | CheckoutDraft → Transaction, Items, Payments | Duplicate charge for same appointment while a COMPLETED TX exists (VOIDED allows re-checkout) | payments, void |
| **Package / SV deduction** | Redemption intent | Ledger entries | PackageLedger / StoredValueLedger | Silent balance mutate without ledger | actor, reason, refs |
| **Follow Up** | Treatment follow-up tags/date | CRM task | FollowUp | Lost follow-up after complete | created_by |
| **Rebooking** | Follow-up / customer request | New Appointment | Appointment | Orphan follow-up without link | link ids |

---

## Appointment lifecycle (future recommendation)

### Recommended statuses

| Status | Meaning |
|--------|---------|
| `DRAFT` | Incomplete booking (online hold / staff drafting) |
| `BOOKED` | Reserved |
| `CONFIRMED` | Customer or staff confirmed |
| `ARRIVED` | Checked in |
| `IN_SERVICE` | Treatment in progress |
| `COMPLETED` | Visit finished (treatment done; checkout may still be pending) |
| `CANCELLED` | Cancelled before service |
| `NO_SHOW` | Did not arrive |

### Allowed transitions (happy path)

```text
DRAFT → BOOKED → CONFIRMED → ARRIVED → IN_SERVICE → COMPLETED
BOOKED / CONFIRMED → CANCELLED
BOOKED / CONFIRMED / ARRIVED → NO_SHOW
```

### Diff vs current prototype (`AppointmentStatus`)

| Current (app) | Future recommendation | Notes |
|---------------|----------------------|-------|
| `pending` | `BOOKED` / `CONFIRMED` | Collapse of pre-arrival states |
| `in_progress` | `IN_SERVICE` | Align naming |
| `completed` | `COMPLETED` | Keep meaning |
| _(missing)_ | `DRAFT`, `ARRIVED`, `CANCELLED`, `NO_SHOW` | Add later |

**Phase 4.8A** implements this matrix in `lib/appointments/domain.ts`. Legacy `pending` / `in_progress` / `completed` still exist on Today cards and are mapped by `normalizeAppointmentStatus()`. Appointment `COMPLETED` means the visit finished — it is not Checkout / paid.

### Audit trail for appointments

Store append-only `appointment_status_events`:

- `from_status`, `to_status`
- `actor_user_id`
- `organization_id`, `location_id`
- `reason` (optional)
- `created_at`

---

## Treatment lifecycle (aligned with current workflow)

### Current UI steps (keep)

1. Customer Summary  
2. Assessment  
3. Body Map  
4. Operations  
5. Photos  
6. Professional Note  
7. Follow Up  
8. Complete  

### Status (current → future)

| Current | Future |
|---------|--------|
| `draft` | `IN_PROGRESS` (or keep `draft` for local autosave) |
| `completed` | `COMPLETED` |
| _(none)_ | `VOIDED` (admin correction — rare) |

### Rules

- One **open** treatment draft per appointment (prototype already appointment-keyed).
- Completing treatment may set appointment → `IN_SERVICE` then `COMPLETED` (or leave checkout open — product decision: **recommend** appointment COMPLETED when treatment completes; checkout can still attach).
- Do **not** invent a second treatment for the same completed appointment without explicit “additional service” product flow.

### What treatment must not invent

- Financial totals (belong to Transaction)
- Package balance mutation without ledger
- Overwriting prior consultations

---

## Checkout placement

Checkout may start:

- From **Appointment Detail** when status is `IN_SERVICE` or `COMPLETED` (and not already paid)
- From **Treatment complete** as an optional CTA (does not auto-charge)
- From **Sidebar → 結帳** candidate list (today’s eligible unpaid visits)

**Phase 4.9A** implements CheckoutDraft → Transaction with integer TWD, mixed tender exact match, and immutable snapshots.  
**Phase 4.9B** adds Package / Stored Value ledgers applied only on settle (`applyCommerceLedgerEffects`). See [checkout.md](./checkout.md), [package-ledger.md](./package-ledger.md), [stored-value-ledger.md](./stored-value-ledger.md).  
**Phase 4.9C** hardens the end-to-end loop and documents sources of truth — see [core-business-flow.md](./core-business-flow.md) and [domain-invariants.md](./domain-invariants.md).  
**Phase 4.10A** full void + ledger reversal — [transaction-void.md](./transaction-void.md).  
**Phase 4.10B** Product catalog + walk-in retail — [product-domain.md](./product-domain.md), [retail-sales.md](./retail-sales.md). Sidebar 結帳 also supports 「一般銷售」without appointment.  
**Phase 4.10C** Location inventory movement ledger + sale/void stock effects — [inventory-domain.md](./inventory-domain.md).

Appointment `COMPLETED` ≠ Transaction `COMPLETED`.

Either way: create **Transaction**, not mutate Treatment into a bill.

Recommended link fields:

- `transaction.appointment_id?`
- `transaction.treatment_id?`
- `transaction.customer_id`
- `transaction.location_id`
- `transaction.organization_id`

---

## Package / stored value in the loop

On checkout line `PACKAGE` purchase → CustomerPackage + opening ledger `PURCHASE` / `GIFT`.  
On checkout / treatment redemption → ledger `REDEMPTION` (−1 session) referencing treatment/appointment.  
Stored value top-up / spend → StoredValueLedger entries; balance = sum(entries).

---

## Follow Up → Rebooking

| From | Creates |
|------|---------|
| Treatment.followUp.suggestedDate / tags | FollowUp task |
| FollowUp “book next” | Appointment (DRAFT/BOOKED) with `source_follow_up_id` |

CRM must not silently create appointments without staff/customer confirmation (MVP: staff-driven).
