# Transaction Domain

Phase 4.9A + **4.9B** ledger side-effects. Immutable commerce record after checkout settle.

## Entity

`Transaction` (`lib/commerce/domain.ts`):

`organizationId` · `locationId` · `customerId` · optional `appointmentId` / `treatmentId` · `transactionNumber` · `status` (`COMPLETED` | `VOIDED`) · snapshotted `items` / `discounts` / `payments` · `subtotal` / `discountTotal` · `total` · `currency` · `createdByStaffId` · `completedAt`

Storage: `beauty-os:{organizationId}:transactions:v1`  
Counter: `beauty-os:{organizationId}:transaction-counter:v1` → `TX-YYYYMMDD-0001`

## Immutability

After COMPLETED:

- Do not mutate items, payments, or totals.
- Service / PackageDefinition catalog changes must not alter historical rows.
- No hard delete.

## Snapshots

- SERVICE / CUSTOM: `nameSnapshot`, `unitPrice`
- `PACKAGE_PURCHASE`: definition name / sessions / price snapshots on the line
- Payments include `STORED_VALUE` amounts at settle time

## Package / stored value (4.9B)

After Transaction is written, `applyCommerceLedgerEffects`:

| Item / payment | Ledger effect |
|----------------|---------------|
| `PACKAGE_PURCHASE` | CustomerPackage + PURCHASE entry |
| `STORED_VALUE_TOP_UP` | TOP_UP entry |
| draft `packageRedemption` | REDEMPTION −1 |
| payment `STORED_VALUE` | PAYMENT −amount |

Idempotent via `effectKey`. Zero-total package redemption is a valid Transaction.

## Void / refund (future)

- Prefer `VOIDED` + compensating ledger REVERSAL entries — never rewrite Transaction totals.
- Full refund UI is out of 4.9B scope; domain `reverse*` helpers exist.
