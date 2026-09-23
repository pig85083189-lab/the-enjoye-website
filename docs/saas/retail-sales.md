# Retail Sales

Phase **4.10B** — Walk-in / general retail checkout using Product catalog + shared commerce.

## Walk-in retail

Not every sale has an Appointment.

```text
Customer → Checkout (empty draft) → PRODUCT (± SERVICE) → payments → Transaction
```

- `appointmentId` / `treatmentId` optional
- **Customer required** (no anonymous / guest sale yet)
- `locationId` must be explicit, belong to org, and be actor-accessible
- Appointment checkout still uses `appointment.locationId`
- General retail uses the **authorized current location** passed explicitly into domain APIs

Entry: `/staff/checkout` → 「一般銷售」

## Mixed cart

Same CheckoutDraft / `completeCheckout` as services:

| Line | Behavior |
|------|----------|
| `SERVICE` | Price from Service; package redemption may zero eligible SERVICE |
| `PRODUCT` | Price from Product.priceMinor at add time; quantity ≥ 1 |
| Package / SV top-up | Existing Wallet / item flows |

**Package sessions cannot redeem PRODUCT.** Product lines remain payable.

## Payments

Reuse existing tender: cash / card / transfer / stored value / mixed.

- Stored value **may** pay Product
- Stored value **cannot** pay `STORED_VALUE_TOP_UP` (unchanged)
- No Product-specific payment system

## Settle effects

PRODUCT creates Transaction snapshots. Phase **4.10C** also posts location `SALE` inventory movements (no cost/COGS).  
Package / stored-value effects unchanged when those items/payments exist.

See [inventory-movements.md](./inventory-movements.md).

## Transaction history

Transaction is the canonical sale record (service + product).  
No separate “Product Orders” table.

Detail UI labels item type (`服務` / `商品` / …) via `CHECKOUT_ITEM_TYPE_LABEL`.

## Void (4.10A + 4.10C)

Product transactions void through `voidTransaction`:

- Original PRODUCT snapshots preserved
- Inventory SALE reversed with compensating `REVERSAL` (+qty) — see [inventory-movements.md](./inventory-movements.md)
- Stored-value / package reversals unchanged when present
- External tenders → manual handling

See [transaction-void.md](./transaction-void.md) · [product-domain.md](./product-domain.md).
