/**
 * Reporting types — Phase 4.11D.
 * Derived / read-only. Never persist report rows as business SoT.
 */

import type { PaymentMethod } from "@/lib/commerce/domain";

/** Inclusive local-time window (browser local; no Organization TZ yet). */
export interface ReportDateRange {
  startAt: Date;
  endAt: Date;
}

export type ReportPreset = "today" | "week" | "month" | "custom";

export interface ReportQuery {
  organizationId: string;
  range: ReportDateRange;
  /** undefined = all locations the org owns */
  locationId?: string;
}

export interface RevenueSummary {
  /** Sum of COMPLETED external inflow (CASH / CARD / TRANSFER / OTHER) */
  revenueMinor: number;
  /** COMPLETED txs with external inflow > 0 */
  transactionCount: number;
  /** COMPLETED txs with no external inflow (SV-only / package redemption) */
  zeroTotalCompletedCount: number;
  /** revenue / transactionCount, or 0 */
  averageTicketMinor: number;
}

export interface PaymentBreakdownRow {
  method: PaymentMethod;
  amountMinor: number;
}

export interface SalesMixSummary {
  serviceSalesMinor: number;
  productSalesMinor: number;
  serviceLineCount: number;
  productQuantity: number;
  /** PACKAGE_PURCHASE + STORED_VALUE_TOP_UP line totals (ops liability / prepaid — not mixed into service/product) */
  packagePurchaseMinor: number;
  storedValueTopUpMinor: number;
}

export interface AppointmentSummary {
  /** Non-DRAFT appointments with startAt in range */
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  /** BOOKED / CONFIRMED / ARRIVED / IN_SERVICE */
  incomplete: number;
  /** completed / total, or 0 */
  completionRate: number;
  cancellationRate: number;
  noShowRate: number;
  incompleteRate: number;
}

export interface TreatmentSummary {
  completedCount: number;
  openDraftCount: number;
}

export interface CustomerSummary {
  /** Distinct customers with ≥1 COMPLETED revenue tx (total > 0) in range */
  payingCustomerCount: number;
}

export interface FollowUpSummary {
  openCount: number;
  overdueCount: number;
  completedInRangeCount: number;
  /** completedInRange / (open + overdue + completedInRange) snapshot, or 0 */
  completionRate: number;
}

export interface RevenueByDayRow {
  dateYmd: string;
  revenueMinor: number;
}

export interface OpsDashboardReport {
  query: ReportQuery;
  revenue: RevenueSummary;
  payments: PaymentBreakdownRow[];
  salesMix: SalesMixSummary;
  appointments: AppointmentSummary;
  treatments: TreatmentSummary;
  customers: CustomerSummary;
  followUps: FollowUpSummary;
  revenueByDay: RevenueByDayRow[];
}
