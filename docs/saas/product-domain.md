# Product Domain

Phase **4.10B** — Product catalog (retail sellable items).

## Product ≠ Inventory

| Product (4.10B) | Inventory (future) |
|-----------------|--------------------|
| Catalog / price / SKU / barcode | Stock quantity / movements |
| Organization-owned definition | Location-scoped stock |
| Soft deactivate | Warehouse / PO / COGS |

**Never** put `stock` on `Product`. Selling does not store quantity on the catalog row — see Phase **4.10C** [inventory-domain.md](./inventory-domain.md).

## Ownership

- `organizationId` required on every row and API argument
- Same product `id` may exist in different orgs; **no cross-tenant leak**
- Catalog is **organization-wide** (all locations may sell the same product)

## Model

`Product` (`lib/products/domain.ts`):

`id` · `organizationId` · `name` · `description?` · `sku?` · `barcode?` · `category?` (simple string) · `priceMinor` · `currency` · `isActive` · `createdAt` · `updatedAt`

Storage: `beauty-os:{organizationId}:products:v1`

## Pricing

- Integer TWD minor units (`assertNonNegativeMoney`)
- Checkout / Transaction use **snapshots** (`nameSnapshot`, `unitPrice`, `quantity`)
- Renaming / repricing / deactivating a Product **must not** rewrite historical Transactions or open draft lines already added

## SKU / barcode

- Both optional
- SKU unique **within organization** (case-insensitive); may collide across orgs
- Barcode stored for search only — no camera / hardware scanner in 4.10B

## Active / inactive

- UI: 啟用 / 停用 via `deactivateProduct` (no hard delete)
- Inactive: cannot add to **new** Checkout lines
- History: still readable via Transaction snapshots

## Store API

`listProducts` · `getProductById` · `searchProducts` · `createProduct` · `updateProduct` · `deactivateProduct` · `canActorManageProducts`

Manage roles (domain): `OWNER` | `MANAGER`
