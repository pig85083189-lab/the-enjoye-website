import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import type { LineDecisionReason, LineHttpErrorClass } from "@/lib/line/line-types";

export const APPOINTMENT_REMINDER_TIMING_IDS = [
  "day_before_morning",
  "hours_before_3",
] as const;

export type AppointmentReminderTimingId =
  (typeof APPOINTMENT_REMINDER_TIMING_IDS)[number];

export const APPOINTMENT_REMINDER_ACTIVE_STATUSES = [
  "BOOKED",
  "CONFIRMED",
] as const satisfies readonly CanonicalAppointmentStatus[];

export const APPOINTMENT_REMINDER_VOID_STATUSES = [
  "DRAFT",
  "ARRIVED",
  "IN_SERVICE",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const satisfies readonly CanonicalAppointmentStatus[];

export type AppointmentReminderJobStatus =
  | "scheduled"
  | "claimed"
  | "accepted"
  | "failed"
  | "canceled"
  | "expired"
  | "skipped"
  | "pending_confirmation"
  | "reconciled";

export type AppointmentReminderSkipReason =
  | "past_due"
  | "rule_disabled"
  | "timing_disabled"
  | "appointment_inactive"
  | "appointment_cancelled"
  | "appointment_completed"
  | "fingerprint_changed"
  | "unbound"
  | "not_consented"
  | "unsubscribed"
  | "blocked"
  | "quota_exceeded"
  | "quota_unknown"
  | "send_closed"
  | "persist_closed"
  | "cross_org"
  | "duplicate"
  | "inflight"
  | "expired_window"
  | "invalid_recipient"
  | "plaintext_line_id_refused";

export type AppointmentReminderAppointment = {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  serviceId: string;
  serviceName: string;
  locationName?: string;
  startAt: string;
  endAt: string;
  status: CanonicalAppointmentStatus;
};

export type AppointmentReminderRule = {
  organizationId: string;
  automationId: "appointment_reminder";
  enabled: boolean;
  selectedTimingIds: AppointmentReminderTimingId[];
  template: string;
  updatedAt?: string;
};

export type AppointmentReminderJob = {
  id: string;
  organizationId: string;
  appointmentId: string;
  customerId: string;
  serviceId: string;
  timingId: AppointmentReminderTimingId;
  fingerprint: string;
  scheduledFor: string;
  status: AppointmentReminderJobStatus;
  requestId: string;
  claimedAt?: string | null;
  sendClaimedAt?: string | null;
  skipReason?: AppointmentReminderSkipReason | null;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentReminderDelivery = {
  id: string;
  organizationId: string;
  jobId: string;
  requestId: string;
  status: "accepted" | "failed" | "pending_confirmation" | "skipped" | "dry_run" | "reconciled";
  lineRequestId?: string | null;
  httpStatus?: number | null;
  errorClass?: LineHttpErrorClass | null;
  message?: string | null;
  createdAt: string;
};

export type CustomerLineBinding = {
  organizationId: string;
  customerId: string;
  lineUserId: string;
  lineUserIdHash?: string;
  verified: boolean;
  unboundAt?: string | null;
  blockedAt?: string | null;
};

export type AppointmentReminderDryRunRecord = {
  id: string;
  organizationId: string;
  jobId: string | null;
  requestId: string | null;
  eligible: boolean;
  skipReason?: AppointmentReminderSkipReason | null;
  message: string;
  createdAt: string;
};

export type NotificationPreference = {
  organizationId: string;
  customerId: string;
  appointmentReminderOptIn: boolean;
  unsubscribedAt?: string | null;
};

export type AppointmentReminderDecision =
  | { ok: true; requestId: string }
  | { ok: false; reason: LineDecisionReason; message: string; skipReason?: AppointmentReminderSkipReason };

export type PlannedAppointmentReminderJob = {
  organizationId: string;
  appointmentId: string;
  customerId: string;
  serviceId: string;
  timingId: AppointmentReminderTimingId;
  fingerprint: string;
  scheduledFor: string;
};

export function isAppointmentReminderTimingId(
  value: string,
): value is AppointmentReminderTimingId {
  return (APPOINTMENT_REMINDER_TIMING_IDS as readonly string[]).includes(value);
}

export function isAppointmentReminderActiveStatus(
  status: CanonicalAppointmentStatus,
): boolean {
  return (APPOINTMENT_REMINDER_ACTIVE_STATUSES as readonly string[]).includes(status);
}
