# Inventory Movements

Phase **4.10C** — Sale deduction, void restore, receive, adjustment.

## Sale effect

On `completeCheckout`, after payments / package / SV prevalidation and **inventory assert**:

1. Create immutable Transaction  
2. Apply package / SV effects  
3. For each PRODUCT line → `postInventorySale`  
   - `quantityDelta = -quantity`  
   - `locationId = transaction.locationId` (appointment location or retail draft location)  
   - `transactionId` + `transactionItemId` (= checkout item / snapshot `id`)  
   - `effectKey = {txId}:INVENTORY_SALE:{item.id}`

**One SALE movement per PRODUCT cart line** (not aggregated).  
Availability validation **aggregates** same `productId` so multi-line carts cannot oversell.

Retry settle is idempotent via `effectKey`.

## Prevalidation

`assertInventoryAvailableForSale` runs **before** Transaction create.  
If any product insufficient: no TX, no package/SV/inventory writes; draft stays editable.  
Error includes product name, location stock, requested qty.

Add-to-cart / qty UI also checks draft location stock, but completeCheckout re-validates (TOCTOU).

## Void reversal

`voidTransaction` collects SALE movements for the TX, then `reverseInventoryMovement`:

- Append `REVERSAL` with `quantityDelta = -original.quantityDelta`  
- `reversesMovementId` + `effectKey = REV:INV:{movementId}`  
- Original SALE unchanged  
- Retry void does not double-restore  

Inventory reverse runs with package/SV reverses before `markTransactionVoided` (resume-safe).

## Receive / adjustment

- `receiveStock` → RECEIVE `+qty` (note optional)  
- `adjustInventory` → ADJUSTMENT delta; **reason required**; resulting stock ≥ 0  

No supplier / PO / cost / transfer.

## Location semantics

| Flow | Deduction / restore location |
|------|------------------------------|
| Appointment checkout | `appointment.locationId` |
| General retail | Explicit draft `locationId` |
| Manual receive/adjust | Explicit location (actor must access) |

UI location switcher must not rewrite appointment sale location.

## UI

`/staff/products` — current-location stock column, stock panel (per-location balances, receive, adjust, movement history).  
Checkout product picker shows `{location}庫存` / 缺貨.

See [inventory-domain.md](./inventory-domain.md) · [transaction-void.md](./transaction-void.md) · [retail-sales.md](./retail-sales.md).
