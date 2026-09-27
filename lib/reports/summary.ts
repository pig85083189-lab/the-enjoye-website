/**
 * Ops dashboard orchestrator — read-only derived report.
 */
import type { OpsDashboardReport, ReportQuery } from "./domain";
import { getAppointmentSummary } from "./appointments";
import { getCustomerSummary } from "./customers";
import { getFollowUpSummary } from "./follow-ups-metrics";
import {
  getPaymentBreakdown,
  getRevenueByDay,
  getRevenueSummary,
  getSalesMixSummary,
} from "./revenue";
import { getTreatmentSummary } from "./treatments";

export function getOpsDashboardReport(
  query: ReportQuery,
  now: Date = new Date(),
): OpsDashboardReport {
  if (!query.organizationId) {
    throw new Error("organizationId is required");
  }
  return {
    query,
    revenue: getRevenueSummary(query),
    payments: getPaymentBreakdown(query),
    salesMix: getSalesMixSummary(query),
    appointments: getAppointmentSummary(query),
    treatments: getTreatmentSummary(query),
    customers: getCustomerSummary(query),
    followUps: getFollowUpSummary(query, now),
    revenueByDay: getRevenueByDay(query),
  };
}

export type { ReportQuery, OpsDashboardReport } from "./domain";
