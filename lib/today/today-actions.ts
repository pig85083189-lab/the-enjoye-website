/**
 * Today Dashboard primary CTA derivation — reuses commerce checkout nav + treatment drafts.
 * Does not invent appointment.isPaid / treatment.isPaid.
 */
import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import {
  resolveAppointmentCheckoutNav,
  type AppointmentCheckoutNav,
} from "@/lib/commerce/appointment-checkout-nav";
import {
  buildCommerceCheckoutHref,
  resolveCommerceCheckoutEligibility,
} from "@/lib/commerce/commerce-remote-identity";
import {
  draftHasContent,
  getCompletedTreatmentsForCustomer,
  loadDraft,
} from "@/lib/treatment-draft";
import { isMutedAppointmentStatus } from "@/lib/treatments/treatment-today";
import type { Appointment } from "@/types";
import type { TreatmentDraft } from "@/types/treatment";

export type TodayPrimaryAction =
  | { kind: "start_treatment"; href: string; label: string }
  | { kind: "continue_treatment"; href: string; label: string }
  | { kind: "checkout"; href: string; label: string }
  | { kind: "view_record"; href: string; label: string }
  | { kind: "none" };

function treatmentWorkspaceHref(appointment: Appointment): string {
  return `/staff/treatments/new?customer=${appointment.customerId}&appointment=${appointment.id}`;
}

export function hasOpenTreatmentDraft(
  organizationId: string,
  appointmentId: string,
): boolean {
  const draft = loadDraft(organizationId, appointmentId);
  return Boolean(draft && draft.status === "draft" && draftHasContent(draft));
}

function completedTreatmentHref(
  organizationId: string,
  appointment: Appointment,
): string | undefined {
  const list = getCompletedTreatmentsForCustomer(
    organizationId,
    appointment.customerId,
  );
  const match = list.find((t) => t.appointmentId === appointment.id);
  return match ? `/staff/treatments/${match.id}` : undefined;
}

export type TodayPrimaryActionOptions = {
  treatmentRemoteRead?: boolean;
  remoteTreatment?: TreatmentDraft | null;
  commerceRemoteRead?: boolean;
  allowCheckout?: boolean;
};

/**
 * Primary CTA for Today cards / briefing panel.
 * Priority when completed: checkout → paid record (treatment if known, else TX).
 */
export function resolveTodayPrimaryAction(
  appointment: Appointment,
  canonicalStatus: CanonicalAppointmentStatus | string | undefined,
  options?: TodayPrimaryActionOptions,
): TodayPrimaryAction {
  const status = canonicalStatus ?? appointment.status;
  if (isMutedAppointmentStatus(status)) {
    return { kind: "none" };
  }

  if (options?.commerceRemoteRead) {
    return resolveRemoteCommerceTodayPrimaryAction(appointment, status, options);
  }

  const checkoutNav: AppointmentCheckoutNav = resolveAppointmentCheckoutNav(
    appointment.organizationId,
    appointment.id,
    status,
  );
  const workspace = treatmentWorkspaceHref(appointment);
  const remoteTreatment = options?.treatmentRemoteRead
    ? options.remoteTreatment ?? null
    : undefined;
  const openDraft =
    remoteTreatment !== undefined
      ? remoteTreatment?.status === "draft"
      : hasOpenTreatmentDraft(appointment.organizationId, appointment.id);
  const isInService =
    appointment.status === "in_progress" ||
    status === "IN_SERVICE" ||
    remoteTreatment?.status === "draft";
  const isCompleted =
    appointment.status === "completed" ||
    status === "COMPLETED" ||
    remoteTreatment?.status === "completed";

  if (isCompleted) {
    if (checkoutNav.kind === "checkout") {
      return { kind: "checkout", href: checkoutNav.href, label: "前往結帳" };
    }
    if (checkoutNav.kind === "view_transaction") {
      const treatmentHref =
        remoteTreatment?.status === "completed"
          ? `/staff/treatments/${remoteTreatment.id}`
          : completedTreatmentHref(appointment.organizationId, appointment);
      return {
        kind: "view_record",
        href: treatmentHref ?? checkoutNav.href,
        label: "查看紀錄",
      };
    }
    if (remoteTreatment?.status === "completed") {
      return {
        kind: "view_record",
        href: `/staff/treatments/${remoteTreatment.id}`,
        label: "查看紀錄",
      };
    }
    return { kind: "none" };
  }

  if (isInService || openDraft) {
    return {
      kind: "continue_treatment",
      href: workspace,
      label: "繼續療程",
    };
  }

  return {
    kind: "start_treatment",
    href: workspace,
    label: "開始服務",
  };
}

function resolveRemoteCommerceTodayPrimaryAction(
  appointment: Appointment,
  status: CanonicalAppointmentStatus | string,
  options: TodayPrimaryActionOptions,
): TodayPrimaryAction {
  const workspace = treatmentWorkspaceHref(appointment);
  const treatment = options.remoteTreatment ?? null;
  const eligibility = resolveCommerceCheckoutEligibility({
    appointmentStatus: status,
    treatmentStatus: treatment?.status,
    appointmentId: appointment.id,
    treatmentId: treatment?.id,
    customerId: appointment.customerId,
    serviceId: appointment.serviceId,
  });
  if (eligibility.eligible && treatment) {
    if (options.allowCheckout === false) {
      return {
        kind: "view_record",
        href: `/staff/treatments/${treatment.id}`,
        label: "查看紀錄",
      };
    }
    return {
      kind: "checkout",
      href: buildCommerceCheckoutHref({
        appointmentId: appointment.id,
        treatmentId: treatment.id,
      }),
      label: "前往結帳",
    };
  }

  const openDraft = treatment?.status === "draft";
  const isInService =
    appointment.status === "in_progress" ||
    status === "IN_SERVICE" ||
    openDraft;
  if (isInService || openDraft) {
    return {
      kind: "continue_treatment",
      href: workspace,
      label: "繼續療程",
    };
  }
  if (treatment?.status === "completed") {
    return {
      kind: "view_record",
      href: `/staff/treatments/${treatment.id}`,
      label: "查看紀錄",
    };
  }
  return {
    kind: "start_treatment",
    href: workspace,
    label: "開始服務",
  };
}
