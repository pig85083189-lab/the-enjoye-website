/**
 * Product catalog domain — Phase 4.10B.
 * Product ≠ Inventory. No stock quantity on Product.
 */

export interface Product {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  sku?: string;
  barcode?: string;
  /** Simple string category (no Category entity yet) */
  category?: string;
  priceMinor: number;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const PRODUCT_CATEGORY_SUGGESTIONS = [
  "臉部保養",
  "身體保養",
  "居家保養",
  "保健食品",
  "其他",
] as const;

export const CHECKOUT_ITEM_TYPE_LABEL: Record<string, string> = {
  SERVICE: "服務",
  PRODUCT: "商品",
  CUSTOM: "自訂",
  PACKAGE_PURCHASE: "套票購買",
  STORED_VALUE_TOP_UP: "儲值",
};
