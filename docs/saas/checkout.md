# Checkout Architecture

Phase **4.9A** foundation + **4.9B** package / stored-value orchestration (localStorage prototype).

**Treatment ≠ Transaction.** **Appointment COMPLETED ≠ paid.**

---

## CheckoutDraft lifecycle

```text
OPEN → READY → COMPLETED
OPEN → VOIDED (reserved)
```

| Status | Meaning |
|--------|---------|
| `OPEN` | Editable cart + payments + package selection |
| `READY` | Optional marker before settle |
| `COMPLETED` | Settled; Transaction + ledger effects applied; **immutable** |
| `VOIDED` | Reserved — no delete UI |

Drafts: `beauty-os:{organizationId}:checkout-drafts:v1`

### Draft recovery

OPEN drafts survive refresh. Cross-org / invalid location references fail closed. Selecting a package or SV amount on a draft **does not** mutate ledgers.

---

## Items

| Type | Status |
|------|--------|
| `SERVICE` | Yes — `Service.priceMinor` snapshot |
| `CUSTOM` | Yes |
| `PACKAGE_PURCHASE` | 4.9B — definition snapshots (name, sessions, price) |
| `STORED_VALUE_TOP_UP` | 4.9B |
| `PRODUCT` | Reserved — not enabled |

---

## Discount

| Type | `value` |
|------|---------|
| `ORDER_FIXED` | minor units |
| `ORDER_PERCENTAGE` | **basis points** (1000 = 10%) |

Package redemption zeros the eligible SERVICE line via line `discountAmount` (selection on draft; ledger on settle).

---

## Payment & mixed tender

Active: `CASH` · `CARD` · `TRANSFER` · `STORED_VALUE` · `OTHER`  
Reserved: `PACKAGE` (redemption is not a payment method)

**Settle rule:** `sum(payments) === total` (exact).  
**Zero-total** (full package redemption): allowed with **no** payment rows (`0 === 0`).

Stored-value payments cannot exceed available balance or remaining due.  
Stored-value **cannot** pay for `STORED_VALUE_TOP_UP`.

---

## completeCheckout orchestration (4.9B)

```text
validate payments / SV balance / package selection
→ create immutable Transaction
→ applyCommerceLedgerEffects (idempotent effectKey)
→ mark CheckoutDraft COMPLETED
```

Effects: package purchase · SV top-up · package redemption · SV payment.

Prototype limitation: localStorage is not a DB transaction; retries rely on `effectKey` uniqueness and “already completed” guards.

---

## Eligibility (appointment checkout)

`IN_SERVICE` | `COMPLETED` only. One COMPLETED Transaction per `appointmentId`.

Location on Transaction = **appointment.locationId** (not current UI location).

---

## Entry points

- `/staff/checkout`
- Appointment Detail → 前往結帳
- Treatment Complete → 前往結帳 (optional)
- Customer Wallet → 購買套票 / 儲值
- Customer Detail → 交易紀錄 / 錢包
