import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import type { LineAutomationId } from "@/lib/line/automations/types";

export const LINE_AUTOMATION_SCHEDULE_TIMEZONE = "Asia/Taipei";
export const LINE_AUTOMATION_MORNING_HM = "10:00";

export const LINE_HOLIDAY_CALENDAR_READY = false;
export const LINE_COUPON_CATALOG_READY = false;

export const APPLY_LINE_AUTOMATION_SCHEDULE_RPC = "apply_line_automation_schedule";
export const READ_LINE_AUTOMATION_SCHEDULE_RPC = "read_line_automation_schedule";

export const LINE_AUTOMATION_JOB_ACTIVE_STATUSES = [
  "scheduled",
  "pending_recipient",
  "claimed",
] as const;

export const LINE_AUTOMATION_JOB_TERMINAL_STATUSES = [
  "accepted",
  "failed",
  "canceled",
  "expired",
  "skipped",
  "pending_confirmation",
  "reconciled",
] as const;

export const LINE_AUTOMATION_JOB_NEVER_RESEND_STATUSES = [
  "accepted",
  "pending_confirmation",
  "reconciled",
] as const;

export const LINE_AUTOMATION_JOB_MUTABLE_STATUSES = [
  "scheduled",
  "pending_recipient",
] as const;

export type LineAutomationJobStatus =
  | (typeof LINE_AUTOMATION_JOB_ACTIVE_STATUSES)[number]
  | (typeof LINE_AUTOMATION_JOB_TERMINAL_STATUSES)[number];

export type LineAutomationScheduleDecision =
  | "planned"
  | "pending_recipient"
  | "skipped_disabled"
  | "skipped_missing_data"
  | "skipped_ineligible"
  | "skipped_past"
  | "skipped_unsupported_timing"
  | "blocked_missing_source"
  | "blocked_send_closed";

export type LineAutomationEventKind =
  | "appointment"
  | "customer_birthday"
  | "holiday_occurrence"
  | "treatment"
  | "customer_package";

export type LineAutomationDependencyId = "holiday_calendar" | "coupon_catalog";

export type LineAutomationScheduleRule = {
  organizationId: string;
  automationType: LineAutomationId;
  enabled: boolean;
  selectedTimingIds: string[];
  template: string;
};

export type LineAutomationScheduleAppointment = {
  id: string;
  organizationId: string;
  customerId: string;
  startAt: string;
  status: CanonicalAppointmentStatus;
};

export type LineAutomationScheduleCustomer = {
  id: string;
  organizationId: string;
  birthdayYmd?: string | null;
  status?: string | null;
  verifiedLineBinding: boolean;
};

export type LineAutomationScheduleTreatment = {
  id: string;
  organizationId: string;
  customerId: string;
  completedAt?: string | null;
  status: string;
};

export type LineAutomationSchedulePackage = {
  id: string;
  organizationId: string;
  customerId: string;
  expiresAt?: string | null;
  status: string;
  source: "customer_package";
};

export type LineAutomationHolidayOccurrence = {
  id: string;
  holidayId: "cny" | "mid_autumn" | "christmas";
  dateYmd: string;
};

export type LineAutomationExistingJob = {
  id: string;
  organizationId: string;
  automationType: LineAutomationId;
  eventId: string;
  customerId: string;
  timingId: string;
  fingerprint: string;
  scheduledFor: string;
  status: LineAutomationJobStatus;
  messageSnapshot: string;
};

export type LineAutomationProposedJob = {
  organizationId: string;
  automationType: LineAutomationId;
  eventKind: LineAutomationEventKind;
  eventId: string;
  customerId: string;
  timingId: string;
  fingerprint: string;
  fireAt: string;
  messageSnapshot: string;
  recipientReady: boolean;
  decision: Extract<
    LineAutomationScheduleDecision,
    "planned" | "pending_recipient"
  >;
};

export type LineAutomationSkippedCandidate = {
  organizationId: string;
  automationType: LineAutomationId;
  eventId?: string;
  customerId?: string;
  timingId?: string;
  decision: Exclude<
    LineAutomationScheduleDecision,
    "planned" | "pending_recipient"
  >;
  reason: string;
};

export type LineAutomationScheduleSnapshot = {
  organizationId: string;
  rules: readonly LineAutomationScheduleRule[];
  appointments?: readonly LineAutomationScheduleAppointment[];
  customers?: readonly LineAutomationScheduleCustomer[];
  treatments?: readonly LineAutomationScheduleTreatment[];
  packages?: readonly LineAutomationSchedulePackage[];
  holidayOccurrences?: readonly LineAutomationHolidayOccurrence[];
  existingJobs?: readonly LineAutomationExistingJob[];
  nowMs?: number;
};

export type LineAutomationSchedulePlan = {
  organizationId: string;
  proposed: LineAutomationProposedJob[];
  skipped: LineAutomationSkippedCandidate[];
  missingDependencies: LineAutomationDependencyId[];
  sendOpen: false;
};

export type LineAutomationScheduleMutation = {
  insert: LineAutomationProposedJob[];
  update: Array<LineAutomationProposedJob & { id: string }>;
  cancel: LineAutomationExistingJob[];
  unchanged: LineAutomationExistingJob[];
};
