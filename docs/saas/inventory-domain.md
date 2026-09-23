# Inventory Domain

Phase **4.10C** — Location-scoped stock via immutable movements.

## Product vs Inventory

| Product (4.10B) | Inventory (4.10C) |
|-----------------|-------------------|
| Organization catalog / price / SKU | Per-location quantity |
| Soft deactivate | Append-only movements |
| No `product.stock` | Balance = `SUM(quantityDelta)` |

Selling uses **sale location** stock only — never organization total.

## Model

`InventoryMovement` (`lib/inventory/domain.ts`):

`id` · `organizationId` · `locationId` · `productId` · `type` · `quantityDelta` · `reason?` · `note?` · `transactionId?` · `transactionItemId?` · `reversesMovementId?` · `effectKey?` · `createdAt` · `createdByStaffId`

Storage: `beauty-os:{organizationId}:inventory-movements:v1`

## Movement types

| Type | quantityDelta | Source |
|------|---------------|--------|
| `RECEIVE` | `> 0` | Manual receive (no PO) |
| `SALE` | `< 0` | `completeCheckout` PRODUCT lines |
| `ADJUSTMENT` | `≠ 0` | Manual count correction |
| `REVERSAL` | `> 0` (for SALE reverse) | `voidTransaction` stock restore |

Documented choice: void uses type **`REVERSAL`** (not `VOID_REVERSAL`), aligned with package/SV naming.

## Immutability

Append-only. Never update/delete past rows. Corrections = new movements.

## Stock selectors

- `getProductStock(org, locationId, productId)`
- `listInventoryByLocation`
- `listProductInventoryAcrossLocations`
- `listInventoryMovements` (filters + deterministic sort)

## Negative policy

All resulting balances must be `>= 0` (sale, adjustment). No `allowNegativeInventory` flag yet.

## RBAC

Receive / adjust: `OWNER` | `MANAGER` + location membership.  
Receptionist: may view stock and sell via checkout.  
Domain still fail-closed.

See [inventory-movements.md](./inventory-movements.md) · [product-domain.md](./product-domain.md).
