# Core Business Flow

Phase **4.9C**. End-to-end operating loop for Beauty OS SPA.

```text
Customer
  → Appointment (org + location)
  → Treatment (clinical)
  → CheckoutDraft (commerce workbench)
  → Transaction (immutable)
       ↳ PackageLedger / StoredValueLedger effects
```

## Source of truth

| Concern | Canonical |
|---------|-----------|
| Schedule | `ScheduleAppointment` schedule store |
| Clinical | Treatment draft / completed treatments |
| Money document | `Transaction` (immutable) |
| Package balance | `SUM(PackageLedgerEntry.sessionDelta)` |
| Stored value | `SUM(StoredValueLedgerEntry.amountDelta)` |
| Checkout work | `CheckoutDraft` until COMPLETED |

**Not SoT:** `Customer.packages[].remainingSessions` (seed residue), Appointment `remainingSessions`, Treatment “paid” flags.

## Location semantics

| Entity | Scope |
|--------|-------|
| Customer, Package balance, Stored value | Organization-wide |
| Appointment, Treatment location, Transaction, Ledger activity | Org + Location |

Checkout from appointment uses **appointment.locationId**, not the current UI location switcher.

## Separation

Appointment `COMPLETED` ≠ Transaction paid.  
Treatment complete ≠ auto-charge.  
Package / SV selection on OPEN draft does not mutate ledgers.
