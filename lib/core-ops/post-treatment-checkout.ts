/**
 * Post-treatment checkout orchestration.
 * Selects packageRedemption on an existing Checkout draft — never writes ledger.
 * Ledger redeem is only applied later by commerce settle.
 */

import { getScheduleAppointment } from "@/lib/appointments/store";
import {
  createCheckoutFromAppointment,
  getOpenDraftForAppointment,
  setPackageRedemption,
} from "@/lib/commerce/checkout-store";
import type { CheckoutDraft } from "@/lib/commerce/domain";
import { listUsablePackagesForService } from "@/lib/packages/store";
import {
  PACKAGE_ELIGIBILITY_ERROR_MESSAGE,
  buildPostTreatmentCheckoutHref,
  toPostTreatmentPackageCard,
  type EligiblePackagesLoad,
} from "./post-treatment-derived";

export function loadEligiblePackagesForTreatment(input: {
  organizationId: string;
  customerId: string;
  serviceId: string;
}): EligiblePackagesLoad {
  try {
    const packages = listUsablePackagesForService(
      input.organizationId,
      input.customerId,
      input.serviceId,
    ).map(toPostTreatmentPackageCard);
    return { status: "ok", packages };
  } catch {
    return { status: "error", message: PACKAGE_ELIGIBILITY_ERROR_MESSAGE };
  }
}

export function applyPostTreatmentCheckoutIntent(input: {
  organizationId: string;
  appointmentId: string;
  createdByStaffId: string;
  treatmentId?: string;
  /** Canonical CustomerPackage.id. null clears a prior selection. */
  customerPackageId?: string | null;
}): { draft: CheckoutDraft; href: string } {
  const apt = getScheduleAppointment(input.organizationId, input.appointmentId);
  if (!apt || apt.organizationId !== input.organizationId) {
    throw new Error("Appointment not found");
  }

  const existing = getOpenDraftForAppointment(
    input.organizationId,
    input.appointmentId,
  );
  const draft =
    existing ??
    createCheckoutFromAppointment(input.organizationId, {
      appointmentId: input.appointmentId,
      createdByStaffId: input.createdByStaffId,
      treatmentId: input.treatmentId,
    });

  let next: CheckoutDraft = draft;
  if (input.customerPackageId) {
    next = setPackageRedemption(input.organizationId, draft.id, {
      customerPackageId: input.customerPackageId,
      serviceId: apt.serviceId,
      sessions: 1,
    });
  } else if (input.customerPackageId === null && draft.packageRedemption) {
    next = setPackageRedemption(input.organizationId, draft.id, null);
  }

  return {
    draft: next,
    href: buildPostTreatmentCheckoutHref({
      appointmentId: input.appointmentId,
      treatmentId: input.treatmentId ?? next.treatmentId,
      customerPackageId: next.packageRedemption?.customerPackageId,
    }),
  };
}
