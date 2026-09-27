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
  draftHasContent,
  getCompletedTreatmentsForCustomer,
  loadDraft,
} from "@/lib/treatment-draft";
import type { Appointment } from "@/types";

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

/**
 * Primary CTA for Today cards / briefing panel.
 * Priority when completed: checkout → paid record (treatment if known, else TX).
 */
export function resolveTodayPrimaryAction(
  appointment: Appointment,
  canonicalStatus: CanonicalAppointmentStatus | string | undefined,
): TodayPrimaryAction {
  const status = canonicalStatus ?? appointment.status;
  const checkoutNav: AppointmentCheckoutNav = resolveAppointmentCheckoutNav(
    appointment.organizationId,
    appointment.id,
    status,
  );
  const workspace = treatmentWorkspaceHref(appointment);
  const openDraft = hasOpenTreatmentDraft(
    appointment.organizationId,
    appointment.id,
  );
  const isInService =
    appointment.status === "in_progress" ||
    status === "IN_SERVICE";
  const isCompleted =
    appointment.status === "completed" || status === "COMPLETED";

  if (isCompleted) {
    if (checkoutNav.kind === "checkout") {
      return { kind: "checkout", href: checkoutNav.href, label: "前往結帳" };
    }
    if (checkoutNav.kind === "view_transaction") {
      const treatmentHref = completedTreatmentHref(
        appointment.organizationId,
        appointment,
      );
      return {
        kind: "view_record",
        href: treatmentHref ?? checkoutNav.href,
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
