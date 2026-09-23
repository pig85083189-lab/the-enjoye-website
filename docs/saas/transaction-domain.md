# Transaction Domain

Phase 4.9A + **4.9B** ledger side-effects. Immutable commerce record after checkout settle.

## Entity

`Transaction` (`lib/commerce/domain.ts`):

`organizationId` · `locationId` · `customerId` · optional `appointmentId` / `treatmentId` · `transactionNumber` · `status` (`COMPLETED` | `VOIDED`) · snapshotted `items` / `discounts` / `payments` · `subtotal` / `discountTotal` · `total` · `currency` · `createdByStaffId` · `completedAt` · optional void metadata (`voidedAt` · `voidedBy` · `voidReason`)

Storage: `beauty-os:{organizationId}:transactions:v1`  
Counter: `beauty-os:{organizationId}:transaction-counter:v1` → `TX-YYYYMMDD-0001`

## Immutability

After COMPLETED:

- Do not mutate items, payments, or totals.
- Service / PackageDefinition catalog changes must not alter historical rows.
- No hard delete.

## Snapshots

- SERVICE / CUSTOM: `nameSnapshot`, `unitPrice`
- **PRODUCT (4.10B):** `referenceId` = productId · `nameSnapshot` · `unitPrice` · `quantity` — catalog rename/price/deactivate must not rewrite history
- `PACKAGE_PURCHASE`: definition name / sessions / price snapshots on the line
- Payments include `STORED_VALUE` amounts at settle time
- Walk-in retail: `appointmentId` / `treatmentId` may be omitted; `customerId` + `locationId` required

## Package / stored value (4.9B)

After Transaction is written, `applyCommerceLedgerEffects`:

| Item / payment | Ledger effect |
|----------------|---------------|
| `PACKAGE_PURCHASE` | CustomerPackage + PURCHASE entry |
| `STORED_VALUE_TOP_UP` | TOP_UP entry |
| draft `packageRedemption` | REDEMPTION −1 |
| payment `STORED_VALUE` | PAYMENT −amount |

Idempotent via `effectKey`. Zero-total package redemption is a valid Transaction.

## Void (Phase 4.10A)

Full transaction void is implemented — see **[transaction-void.md](./transaction-void.md)**.

- Canonical command: `voidTransaction(...)` only
- Keep original snapshots (including PRODUCT); set `status = VOIDED` + metadata
- Compensating package / stored-value `REVERSAL` rows (`reversesEntryId`)
- PRODUCT void: inventory `REVERSAL` restores location stock (`reversesMovementId`)
- External cash/card/transfer/other → manual store handling (not fake ledgers)
- Partial refund / gateway refund = **out of scope** (future)
