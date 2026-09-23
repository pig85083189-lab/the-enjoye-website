# Transaction Void

Phase **4.10A** — Full transaction void + financial ledger reversal.

## Void vs Refund

| | Void (4.10A) | Refund (future) |
|--|--------------|-----------------|
| Scope | Entire COMPLETED transaction | Partial items / amounts |
| Original TX | Kept; `status = VOIDED`; totals unchanged | May create separate refund records |
| Ledgers | Compensating `REVERSAL` rows | Separate workflows |
| External cash/card | Manual store handling only | Gateway / drawer flows |

Void means: **this completed transaction is reversed in system books.**  
It does **not** mean the system completed a physical cash/card refund.

## Eligibility

Only `COMPLETED` transactions may void.

- Already `VOIDED` → idempotent return (no second reversal)
- Missing / wrong org → reject
- Actor without org membership → reject
- Actor role not `OWNER` | `MANAGER` → reject
- Empty / whitespace reason → reject

## Command boundary

Canonical API: `voidTransaction(organizationId, transactionId, { actorStaffId, reason })`  
(`lib/commerce/void-transaction.ts`)

UI must not call `reversePackageLedgerEntry` / `reverseStoredValueLedgerEntry` / `markTransactionVoided` for voids.

Flow:

```text
validate actor + reason + tx
→ load linked package / SV ledger effects
→ prevalidate balances (no negative after planned reversals)
→ append REVERSAL entries (reuse reverse*)
→ mark Transaction VOIDED + metadata
```

## Immutability

Never mutate original:

- items / discounts / payments
- subtotal / discountTotal / **total**

Void metadata only: `voidedAt` · `voidedBy` · `voidReason` · `status = VOIDED`.

## Package

| Original effect | Void |
|-----------------|------|
| REDEMPTION −1 | REVERSAL +1 |
| PURCHASE +N unused | REVERSAL −N; package may become `VOIDED` |
| PURCHASE with later usage | **BLOCK** if reversal would make balance &lt; 0 |

## Stored value

| Original effect | Void |
|-----------------|------|
| PAYMENT −amount | REVERSAL +amount |
| TOP_UP unused | REVERSAL −amount |
| TOP_UP already spent | **BLOCK** if balance would go negative |

## Mixed / external tender

Stored-value portion → ledger REVERSAL.  
`CASH` / `CARD` / `TRANSFER` / `OTHER` → `externalTenderActions` with  
`status: MANUAL_EXTERNAL_REQUIRED` — **not** a fake payment ledger.  
UI must say 需人工處理退款, never 已退款.

## Reversal linkage & idempotency

- `reversesEntryId` = original ledger entry id
- `effectKey` = `REV:PKG:{entryId}` / `REV:SV:{entryId}`
- Same void twice → no double reverse
- `reverse*` helpers return the existing REVERSAL when already reversed (resume-safe)

## Failure safety

All validations run **before** any write.  
On failure: Transaction stays `COMPLETED`; ledgers unchanged.

## Re-checkout

`hasCompletedTransactionForAppointment` only counts `COMPLETED`.  
After void, a new checkout / Transaction is allowed. History keeps both rows.

## Location

Reversal `locationId` copies the **original** ledger / transaction activity location  
(not the actor’s current UI location).

## Appointment / Treatment

Void does **not** roll back appointment or treatment status.

## Product retail (Phase 4.10B / 4.10C)

Voiding a Transaction that contains PRODUCT lines:

- Keeps PRODUCT snapshots on the VOIDED transaction
- Appends inventory `REVERSAL` for each SALE movement (`reversesMovementId`)
- Package / stored-value reversals still apply when those effects exist

See [retail-sales.md](./retail-sales.md) · [inventory-movements.md](./inventory-movements.md).
