# Core Business Flow

Phase **4.9C**. End-to-end operating loop for Beauty OS SPA.

```text
Customer
  → Appointment (org + location)           // optional for walk-in retail
  → Treatment (clinical)                   // optional
  → CheckoutDraft (commerce workbench)
  → Transaction (immutable)
       ↳ PackageLedger / StoredValueLedger effects
       ↳ PRODUCT lines = snapshots + location Inventory SALE (4.10C)
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

## Void (Phase 4.10A)

Full void via `voidTransaction` only — see [transaction-void.md](./transaction-void.md).

- Original Transaction snapshots stay (SERVICE / PRODUCT / …); `status → VOIDED`
- Package / SV append compensating `REVERSAL` rows
- PRODUCT void does **not** invent inventory reversal
- Appointment / Treatment statuses are **not** rolled back
- After VOIDED, a new checkout for the same appointment is allowed

## Retail (Phase 4.10B / 4.10C)

Walk-in sales without appointment use the same Checkout → Transaction path.  
Inventory deducts at the draft/appointment **locationId**.  
See [retail-sales.md](./retail-sales.md) · [product-domain.md](./product-domain.md) · [inventory-movements.md](./inventory-movements.md).
