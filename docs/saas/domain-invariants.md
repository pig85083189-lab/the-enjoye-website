# Domain Invariants

Phase **4.9C** checklist. Enforced in stores + integration tests.

## Tenant ownership

Every domain API takes explicit `organizationId`. No silent `getActiveOrganizationId()` fallback for mutations.

Same entity IDs across orgs must not leak reads or writes.

## Location semantics

- Customer / package balance / stored-value balance → **organization-wide**
- Appointment / Transaction / ledger **activity** → **org + location**
- Staff schedule → org + location

## Financial history

- Money = integer minor units only
- `discount ≤ subtotal`, `total ≥ 0`
- `sum(payments) === total` (exact); zero-total package checkout may have **no** payment rows
- Stored value balance never negative
- Package usable balance never negative
- Ledger entries and completed Transactions are **immutable** (corrections = REVERSAL / new TX)

## Checkout idempotency

`completeCheckout` is the only settle orchestration:

```text
validate → create Transaction → applyCommerceLedgerEffects → mark draft COMPLETED
```

Retries return the same Transaction and must not double-post ledger effects (`effectKey`).

Failed validation must leave: no new Transaction, no ledger delta, draft not COMPLETED.

## Status

Appointment lifecycle does **not** include `PAID`.  
Payment state is derived from Transaction (`hasCompletedTransactionForAppointment`).

## Legacy compatibility

`Customer.packages` / `remainingSessions` = seed/CRM residue only.  
Customer repository **always** normalizes `packages: []` (including SSR).  
Wallet / Checkout / Transactions use `lib/packages` ledger selectors exclusively.
