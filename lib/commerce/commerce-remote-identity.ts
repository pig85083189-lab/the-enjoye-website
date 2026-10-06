/**
 * Phase 1C-6H.1 Commerce remote identity + eligibility.
 * Pure read model. Does not persist CheckoutDraft, Transaction, or ledgers.
 */

import type { CanonicalAppointmentStatus, ScheduleAppointment } from "@/lib/appointments/domain";
import { isMutedAppointmentStatus } from "@/lib/treatments/treatment-today";
import {
  resolveCanonicalCustomerDisplayName,
  resolveCanonicalServiceDisplayName,
  resolveCanonicalStaffDisplayName,
} from "@/lib/treatments/treatment-display";
import { canCheckout, type CapabilityActor } from "@/lib/staff-auth/operational-capabilities";
import type { Customer } from "@/types";
import type { Service } from "@/types";
import type { TreatmentDraft, TreatmentStatus } from "@/types/treatment";

export const COMMERCE_CHECKOUT_FORBIDDEN_MESSAGE = "沒有權限結帳";

export type CommerceCheckoutEligibilityReason =
  | "eligible"
  | "no_treatment"
  | "treatment_draft"
  | "appointment_cancelled"
  | "appointment_no_show"
  | "appointment_draft"
  | "missing_identity";

export type CommerceCheckoutEligibility = {
  eligible: boolean;
  reason: CommerceCheckoutEligibilityReason;
};

export type CommerceCheckoutIdentity = {
  organizationId: string;
  customerId: string;
  appointmentId: string;
  treatmentId: string;
  serviceId: string;
  staffId: string;
  locationId: string;
};

/** Next-phase command input. This slice never persists it. */
export type CreateRemoteCheckoutDraftInput = {
  organizationId: string;
  appointmentId: string;
  treatmentId: string;
  customerId: string;
  serviceId: string;
  locationId: string;
  createdByStaffId: string;
};

export type CommerceCheckoutCandidate = {
  identity: CommerceCheckoutIdentity;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  staffName: string;
  locationId: string;
  startAt: string;
  durationMinutes: number;
  appointmentStatus: CanonicalAppointmentStatus;
  treatmentStatus: TreatmentStatus;
  href: string;
};

export function assertCommerceCheckoutReadRole(actor: CapabilityActor): void {
  if (!canCheckout(actor)) {
    throw new Error(COMMERCE_CHECKOUT_FORBIDDEN_MESSAGE);
  }
}

export function isRemoteCommerceTreatmentCompleted(
  treatmentStatus: TreatmentStatus | string | null | undefined,
): boolean {
  return treatmentStatus === "completed" || treatmentStatus === "COMPLETED";
}

export function resolveCommerceCheckoutEligibility(input: {
  appointmentStatus?: CanonicalAppointmentStatus | string | null;
  treatmentStatus?: TreatmentStatus | string | null;
  appointmentId?: string | null;
  treatmentId?: string | null;
  customerId?: string | null;
  serviceId?: string | null;
}): CommerceCheckoutEligibility {
  const appointmentStatus = input.appointmentStatus ?? "";
  if (appointmentStatus === "CANCELLED") {
    return { eligible: false, reason: "appointment_cancelled" };
  }
  if (appointmentStatus === "NO_SHOW") {
    return { eligible: false, reason: "appointment_no_show" };
  }
  if (appointmentStatus === "DRAFT") {
    return { eligible: false, reason: "appointment_draft" };
  }
  if (isMutedAppointmentStatus(appointmentStatus)) {
    return { eligible: false, reason: "appointment_cancelled" };
  }
  if (!input.treatmentId || !input.treatmentStatus) {
    return { eligible: false, reason: "no_treatment" };
  }
  if (!isRemoteCommerceTreatmentCompleted(input.treatmentStatus)) {
    return { eligible: false, reason: "treatment_draft" };
  }
  if (!input.appointmentId || !input.customerId || !input.serviceId) {
    return { eligible: false, reason: "missing_identity" };
  }
  return { eligible: true, reason: "eligible" };
}

export function buildCommerceCheckoutHref(input: {
  appointmentId: string;
  treatmentId?: string;
}): string {
  const params = new URLSearchParams({ appointment: input.appointmentId });
  if (input.treatmentId) params.set("treatment", input.treatmentId);
  return `/staff/checkout?${params.toString()}`;
}

export function buildCommerceTransactionHref(transactionId: string): string {
  return `/staff/transactions?id=${transactionId}`;
}

/** COMPLETED Transaction only. Appointment stored status is not paid truth. */
export function completedTransactionIdsByAppointment(
  transactions: ReadonlyArray<{
    id: string;
    status: string;
    appointmentId?: string | null;
  }>,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const tx of transactions) {
    if (tx.status !== "COMPLETED") continue;
    const appointmentId = tx.appointmentId?.trim();
    if (!appointmentId) continue;
    map.set(appointmentId, tx.id);
  }
  return map;
}

export function isAppointmentSettledByTransaction(
  paidAppointmentIds: ReadonlyMap<string, string> | undefined,
  appointmentId: string | null | undefined,
): boolean {
  if (!paidAppointmentIds || !appointmentId) return false;
  return paidAppointmentIds.has(appointmentId);
}

export function toCreateRemoteCheckoutDraftInput(input: {
  identity: CommerceCheckoutIdentity;
  createdByStaffId: string;
}): CreateRemoteCheckoutDraftInput {
  return {
    organizationId: input.identity.organizationId,
    appointmentId: input.identity.appointmentId,
    treatmentId: input.identity.treatmentId,
    customerId: input.identity.customerId,
    serviceId: input.identity.serviceId,
    locationId: input.identity.locationId,
    createdByStaffId: input.createdByStaffId,
  };
}

export function buildCommerceCheckoutCandidate(input: {
  organizationId: string;
  appointment: ScheduleAppointment;
  treatment: TreatmentDraft;
  customer?: Customer | null;
  service?: Service | null;
}): CommerceCheckoutCandidate | null {
  const eligibility = resolveCommerceCheckoutEligibility({
    appointmentStatus: input.appointment.status,
    treatmentStatus: input.treatment.status,
    appointmentId: input.appointment.id,
    treatmentId: input.treatment.id,
    customerId: input.appointment.customerId,
    serviceId: input.appointment.serviceId,
  });
  if (!eligibility.eligible) return null;
  if (input.appointment.organizationId !== input.organizationId) return null;
  if (input.treatment.organizationId && input.treatment.organizationId !== input.organizationId) {
    return null;
  }
  if (input.treatment.appointmentId && input.treatment.appointmentId !== input.appointment.id) {
    return null;
  }
  if (input.customer && input.customer.organizationId !== input.organizationId) {
    return null;
  }
  if (input.service && input.service.organizationId !== input.organizationId) {
    return null;
  }

  const customerName = resolveCanonicalCustomerDisplayName({
    customerId: input.appointment.customerId,
    catalogName: input.customer?.name,
    snapshotName: input.appointment.customerName,
  });
  const serviceName = resolveCanonicalServiceDisplayName({
    serviceId: input.appointment.serviceId,
    catalogName: input.service?.name,
    snapshotName: input.appointment.serviceName,
  });
  const staffName = resolveCanonicalStaffDisplayName({
    staffId: input.appointment.staffId,
    snapshotName: input.appointment.staffName,
  });

  return {
    identity: {
      organizationId: input.organizationId,
      customerId: input.appointment.customerId,
      appointmentId: input.appointment.id,
      treatmentId: input.treatment.id,
      serviceId: input.appointment.serviceId,
      staffId: input.appointment.staffId,
      locationId: input.appointment.locationId,
    },
    customerName,
    customerPhone: input.customer?.phone ?? "",
    serviceName,
    staffName,
    locationId: input.appointment.locationId,
    startAt: input.appointment.startAt,
    durationMinutes: input.appointment.durationMinutes,
    appointmentStatus: input.appointment.status,
    treatmentStatus: input.treatment.status ?? "completed",
    href: buildCommerceCheckoutHref({
      appointmentId: input.appointment.id,
      treatmentId: input.treatment.id,
    }),
  };
}
