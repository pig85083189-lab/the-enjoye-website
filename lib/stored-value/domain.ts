/**
 * Stored value domain — Phase 4.9B.
 * Balance = SUM(ledger amountDelta). Never mutate a balance field.
 */

export type StoredValueAccountStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";

export type StoredValueLedgerType =
  | "TOP_UP"
  | "PAYMENT"
  | "ADJUSTMENT"
  | "REVERSAL";

export interface StoredValueAccount {
  id: string;
  organizationId: string;
  customerId: string;
  currency: string;
  status: StoredValueAccountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoredValueLedgerEntry {
  id: string;
  organizationId: string;
  accountId: string;
  customerId: string;
  type: StoredValueLedgerType;
  amountDelta: number;
  transactionId?: string;
  appointmentId?: string;
  locationId?: string;
  reason?: string;
  effectKey?: string;
  reversesEntryId?: string;
  createdByStaffId: string;
  createdAt: string;
}

export const STORED_VALUE_LEDGER_TYPE_LABEL: Record<StoredValueLedgerType, string> = {
  TOP_UP: "儲值",
  PAYMENT: "消費",
  ADJUSTMENT: "調整",
  REVERSAL: "沖正",
};
