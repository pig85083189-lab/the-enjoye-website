/**
 * Commerce domain — Phase 4.9A Checkout & Transaction + 4.9B ledger tenders.
 * Money is always integer minor units. TWD: NT$1 = 1.
 */

export const DEFAULT_CURRENCY = "TWD";

/** Fallback when Service.priceMinor is missing (compat adapter — not hardcoded by name). */
export const DEFAULT_SERVICE_PRICE_MINOR = 2000;

export type CheckoutDraftStatus = "OPEN" | "READY" | "COMPLETED" | "VOIDED";

export type CheckoutItemType =
  | "SERVICE"
  | "PRODUCT"
  | "CUSTOM"
  | "PACKAGE_PURCHASE"
  | "STORED_VALUE_TOP_UP";

export type DiscountType = "ORDER_FIXED" | "ORDER_PERCENTAGE";

/**
 * STORED_VALUE enabled in 4.9B.
 * PACKAGE as payment method stays reserved — redemptions use packageRedemption on draft.
 */
export type PaymentMethod =
  | "CASH"
  | "CARD"
  | "TRANSFER"
  | "OTHER"
  | "STORED_VALUE"
  | "PACKAGE";

export const ACTIVE_PAYMENT_METHODS: PaymentMethod[] = [
  "CASH",
  "CARD",
  "TRANSFER",
  "OTHER",
  "STORED_VALUE",
];

export const EXTERNAL_PAYMENT_METHODS: PaymentMethod[] = [
  "CASH",
  "CARD",
  "TRANSFER",
  "OTHER",
];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "現金",
  CARD: "信用卡",
  TRANSFER: "轉帳",
  OTHER: "其他",
  STORED_VALUE: "儲值金",
  PACKAGE: "套票（請用核銷）",
};

export type TransactionStatus = "COMPLETED" | "VOIDED";

export const TRANSACTION_STATUS_LABEL: Record<TransactionStatus, string> = {
  COMPLETED: "已完成",
  VOIDED: "已作廢",
};

/** Intent to redeem one package session on settle — not applied until completeCheckout */
export interface PackageRedemptionSelection {
  customerPackageId: string;
  serviceId: string;
  sessions: 1;
}

export interface CheckoutItem {
  id: string;
  type: CheckoutItemType;
  referenceId?: string;
  nameSnapshot: string;
  unitPrice: number;
  quantity: number;
  lineSubtotal: number;
  discountAmount: number;
  lineTotal: number;
  /** PACKAGE_PURCHASE snapshot */
  sessionCountSnapshot?: number;
}

export interface CheckoutDiscount {
  id: string;
  type: DiscountType;
  /**
   * ORDER_FIXED: minor units off.
   * ORDER_PERCENTAGE: basis points (1000 = 10.00%).
   */
  value: number;
  label?: string;
  reason?: string;
  createdByStaffId?: string;
}

export interface PaymentDraft {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
  note?: string;
}

export interface CheckoutDraft {
  id: string;
  organizationId: string;
  locationId: string;
  customerId: string;
  appointmentId?: string;
  treatmentId?: string;
  items: CheckoutItem[];
  discounts: CheckoutDiscount[];
  payments: PaymentDraft[];
  /** Applied only on successful settle */
  packageRedemption?: PackageRedemptionSelection;
  subtotal: number;
  discountTotal: number;
  total: number;
  currency: string;
  status: CheckoutDraftStatus;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionItemSnapshot {
  id: string;
  type: CheckoutItemType;
  referenceId?: string;
  nameSnapshot: string;
  unitPrice: number;
  quantity: number;
  lineSubtotal: number;
  discountAmount: number;
  lineTotal: number;
  sessionCountSnapshot?: number;
}

export interface TransactionDiscountSnapshot {
  id: string;
  type: DiscountType;
  value: number;
  label?: string;
  reason?: string;
  amountApplied: number;
}

export interface TransactionPaymentSnapshot {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
  note?: string;
  paidAt: string;
}

export interface Transaction {
  id: string;
  organizationId: string;
  locationId: string;
  customerId: string;
  appointmentId?: string;
  treatmentId?: string;
  /** Links settle resume / idempotency for walk-in drafts */
  checkoutDraftId?: string;
  transactionNumber: string;
  status: TransactionStatus;
  items: TransactionItemSnapshot[];
  discounts: TransactionDiscountSnapshot[];
  payments: TransactionPaymentSnapshot[];
  /** Copied from draft for history display */
  packageRedemption?: PackageRedemptionSelection;
  subtotal: number;
  discountTotal: number;
  total: number;
  currency: string;
  createdByStaffId: string;
  completedAt: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

/** Statuses eligible for normal checkout (no deposit/prepayment hack). */
export const CHECKOUT_ELIGIBLE_APPOINTMENT_STATUSES = [
  "IN_SERVICE",
  "COMPLETED",
] as const;
