# Stored Value Ledger

Phase **4.9B** runtime. Balance = `SUM(amountDelta)`. Never mutate `account.balance`.

---

## StoredValueAccount

One account per `(organizationId, customerId)`.

`currency` (prototype `TWD`) · `status` (`ACTIVE` | `SUSPENDED` | `CLOSED`)

---

## StoredValueLedgerEntry (immutable)

| Type | Delta |
|------|-------|
| `TOP_UP` | +amount |
| `PAYMENT` | −amount |
| `ADJUSTMENT` | ±amount (reason required) |
| `REVERSAL` | inverse of prior entry |

Includes `locationId`, `transactionId?`, `effectKey`, `createdByStaffId`.

**Negative balance forbidden** in 4.9B.

---

## Top-up

Checkout item `STORED_VALUE_TOP_UP` → pay with **external** tender only (`CASH` / `CARD` / `TRANSFER` / `OTHER`).

**Forbidden:** pay top-up with `STORED_VALUE` (loop protection).

Ledger `TOP_UP` posts only after Transaction COMPLETED (`applyCommerceLedgerEffects`).

---

## Payment (mixed tender)

`STORED_VALUE` is an active payment method.

Validate: same customer · same org · currency · `amount ≤ available balance` · `amount ≤ remaining due`.

OPEN draft does **not** deduct. Settle posts `PAYMENT` once via `effectKey`.

---

## Cross-location

Balance is **organization-wide**. Activity `locationId` is recorded per entry (where the spend / top-up happened).

---

## Reversal

`reverseStoredValueLedgerEntry` — append inverse once; never delete the original row.

---

## Customer Wallet UI

Customer Detail → **錢包** tab: balance, ledger, top-up / package purchase → Checkout.

---

## Future Supabase

`stored_value_accounts` · `stored_value_ledger_entries` + settle RPC.
