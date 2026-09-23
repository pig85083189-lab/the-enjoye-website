/**
 * Inventory movement domain — Phase 4.10C.
 * Product = org catalog. Stock = location-scoped SUM(quantityDelta).
 */

export type InventoryMovementType =
  | "RECEIVE"
  | "SALE"
  | "ADJUSTMENT"
  | "REVERSAL";

/**
 * Append-only stock movement.
 * REVERSAL = void stock reversal of a SALE (quantityDelta = -original.quantityDelta).
 */
export interface InventoryMovement {
  id: string;
  organizationId: string;
  locationId: string;
  productId: string;
  type: InventoryMovementType;
  /** RECEIVE/REVERSAL typically >0; SALE <0; ADJUSTMENT either */
  quantityDelta: number;
  reason?: string;
  note?: string;
  transactionId?: string;
  transactionItemId?: string;
  reversesMovementId?: string;
  effectKey?: string;
  createdAt: string;
  createdByStaffId: string;
}

export const INVENTORY_MOVEMENT_TYPE_LABEL: Record<InventoryMovementType, string> = {
  RECEIVE: "入庫",
  SALE: "銷售扣庫",
  ADJUSTMENT: "盤點調整",
  REVERSAL: "作廢回補",
};
