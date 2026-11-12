import { isLineAutomationId, lineAutomationBuiltinTimingIds } from "@/lib/line/automations/catalog";
import { automationJobFingerprint } from "@/lib/line/automations/schedule-fire-at";
import type {
  LineAutomationEventKind,
  LineAutomationJobStatus,
} from "@/lib/line/automations/schedule-types";
import type { LineAutomationId } from "@/lib/line/automations/types";

export const LINE_AUTOMATION_EVENT_KIND_BY_TYPE = {
  appointment_reminder: "appointment",
  birthday_greeting: "customer_birthday",
  holiday_greeting: "holiday_occurrence",
  satisfaction_survey: "treatment",
  coupon_expiry: "customer_package",
} as const satisfies Record<LineAutomationId, LineAutomationEventKind>;

export const LINE_AUTOMATION_APPLY_STATUSES = [
  "scheduled",
  "pending_recipient",
] as const;

export function automationEventKindFor(
  automationType: string,
): LineAutomationEventKind | null {
  if (!isLineAutomationId(automationType)) return null;
  return LINE_AUTOMATION_EVENT_KIND_BY_TYPE[automationType];
}

export function isMutableAutomationJobStatus(status: string): boolean {
  return status === "scheduled" || status === "pending_recipient";
}

export function isNeverResendAutomationJobStatus(status: string): boolean {
  return (
    status === "accepted" ||
    status === "pending_confirmation" ||
    status === "reconciled"
  );
}

export function isInFlightAutomationJobStatus(status: string): boolean {
  return status === "claimed";
}

export function canInsertAutomationJob(existing?: LineAutomationJobStatus | null): boolean {
  if (!existing) return true;
  return (
    !isNeverResendAutomationJobStatus(existing) &&
    !isInFlightAutomationJobStatus(existing) &&
    !isMutableAutomationJobStatus(existing)
  );
}

export function canMutateAutomationJob(status: string): boolean {
  return isMutableAutomationJobStatus(status);
}

export function applyStatusForRecipient(recipientReady: boolean): "scheduled" | "pending_recipient" {
  return recipientReady ? "scheduled" : "pending_recipient";
}

export function validateAutomationScheduleItem(input: {
  organizationId: string;
  automationType?: string | null;
  eventKind?: string | null;
  eventId?: string | null;
  customerId?: string | null;
  timingId?: string | null;
  fingerprint?: string | null;
  messageSnapshot?: string | null;
}): { ok: true; automationType: LineAutomationId; eventKind: LineAutomationEventKind } | { ok: false; reason: string } {
  const organizationId = (input.organizationId ?? "").trim();
  const automationType = (input.automationType ?? "").trim();
  const eventKind = (input.eventKind ?? "").trim();
  const eventId = (input.eventId ?? "").trim();
  const customerId = (input.customerId ?? "").trim();
  const timingId = (input.timingId ?? "").trim();
  const fingerprint = (input.fingerprint ?? "").trim();
  if (!organizationId.startsWith("org-")) {
    return { ok: false, reason: "organization mismatch" };
  }
  if (!isLineAutomationId(automationType)) {
    return { ok: false, reason: "invalid automation" };
  }
  const expectedKind = LINE_AUTOMATION_EVENT_KIND_BY_TYPE[automationType];
  if (eventKind !== expectedKind) {
    return { ok: false, reason: "invalid event" };
  }
  const allowed = lineAutomationBuiltinTimingIds(automationType) ?? [];
  if (!timingId || !allowed.includes(timingId)) {
    return { ok: false, reason: "invalid timing" };
  }
  if (!eventId || !customerId) {
    return { ok: false, reason: eventId ? "invalid customer" : "invalid event" };
  }
  if (automationType === "birthday_greeting" && eventId !== customerId) {
    return { ok: false, reason: "invalid customer" };
  }
  if (automationType === "holiday_greeting") {
    return { ok: false, reason: "holiday source missing" };
  }
  const expectedFingerprint = automationJobFingerprint({
    organizationId,
    automationType,
    eventId,
    timingId,
  });
  if (fingerprint !== expectedFingerprint) {
    return { ok: false, reason: "invalid fingerprint" };
  }
  return { ok: true, automationType, eventKind: expectedKind };
}
