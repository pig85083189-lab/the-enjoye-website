/**
 * Shared Today / Calendar checkout CTA semantics.
 * Paid truth comes only from COMPLETED Transaction — never appointment.isPaid.
 */
import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import { CHECKOUT_ELIGIBLE_APPOINTMENT_STATUSES } from "@/lib/commerce/domain";
import {
  getCompletedTransactionForAppointment,
  hasCompletedTransactionForAppointment,
} from "@/lib/commerce/transaction-store";

export type AppointmentCheckoutNav =
  | { kind: "checkout"; href: string }
  | {
      kind: "view_transaction";
      href: string;
      label: string;
      transactionNumber: string;
    }
  | { kind: "none" };

/** Map Today legacy card status → canonical for eligibility checks. */
export function legacyTodayStatusToCanonical(
  status: string,
): CanonicalAppointmentStatus | null {
  if (status === "in_progress" || status === "IN_SERVICE") return "IN_SERVICE";
  if (status === "completed" || status === "COMPLETED") return "COMPLETED";
  return null;
}

export function resolveAppointmentCheckoutNav(
  organizationId: string,
  appointmentId: string,
  status: string,
): AppointmentCheckoutNav {
  const canonical =
    legacyTodayStatusToCanonical(status) ??
    (status as CanonicalAppointmentStatus);
  const eligible = (
    CHECKOUT_ELIGIBLE_APPOINTMENT_STATUSES as readonly string[]
  ).includes(canonical);
  if (!eligible) return { kind: "none" };

  // VOIDED TX does not count — same as hasCompletedTransactionForAppointment
  if (hasCompletedTransactionForAppointment(organizationId, appointmentId)) {
    const tx = getCompletedTransactionForAppointment(
      organizationId,
      appointmentId,
    );
    if (!tx) return { kind: "none" };
    return {
      kind: "view_transaction",
      href: `/staff/transactions?id=${tx.id}`,
      label: "查看交易",
      transactionNumber: tx.transactionNumber,
    };
  }

  return {
    kind: "checkout",
    href: `/staff/checkout?appointment=${appointmentId}`,
  };
}
