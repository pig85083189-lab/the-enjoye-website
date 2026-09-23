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

## Void idempotency (Phase 4.10A)

`voidTransaction` is the only void orchestration:

```text
validate → prevalidate balances → append REVERSAL → mark Transaction VOIDED
```

- Only `COMPLETED` may void; already `VOIDED` returns existing reversals
- `hasCompletedTransactionForAppointment` counts **COMPLETED only** (VOIDED allows re-checkout)
- Failed prevalidation: TX stays COMPLETED; ledgers unchanged
- See [transaction-void.md](./transaction-void.md)

## Status

Appointment lifecycle does **not** include `PAID`.  
Payment state is derived from Transaction (`hasCompletedTransactionForAppointment`).

## Legacy compatibility

`Customer.packages` / `remainingSessions` = seed/CRM residue only.  
Customer repository **always** normalizes `packages: []` (including SSR).  
Wallet / Checkout / Transactions use `lib/packages` ledger selectors exclusively.

## Product catalog (Phase 4.10B)

- Product is organization-owned catalog — **not** the stock balance
- Checkout PRODUCT lines snapshot price/name/qty; catalog edits must not rewrite Transactions
- Package redemption applies only to eligible **SERVICE** lines, never PRODUCT
- See [product-domain.md](./product-domain.md) · [retail-sales.md](./retail-sales.md)

## Inventory (Phase 4.10C)

- Stock = `SUM(InventoryMovement.quantityDelta)` per org + location + product
- Sale / adjustment cannot make balance negative
- Void restores stock via compensating `REVERSAL` movements
- See [inventory-domain.md](./inventory-domain.md) · [inventory-movements.md](./inventory-movements.md)
