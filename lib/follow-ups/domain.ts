/**
 * Follow-up CRM tasks — Phase 4.11C.
 * Treatment.followUp is clinical intent; FollowUpTask is the operable CRM work item.
 * Follow-up ≠ Appointment.
 */

export type FollowUpTaskStatus = "OPEN" | "COMPLETED";

export type FollowUpTaskType = "TREATMENT_FOLLOW_UP" | "REBOOKING";

/** Minimal display snapshot — not a full Treatment copy */
export interface FollowUpContextSnapshot {
  customerName?: string;
  serviceId?: string;
  serviceName?: string;
  staffName?: string;
  followUpTags: string[];
  treatmentNote?: string;
}

export interface FollowUpTask {
  id: string;
  organizationId: string;
  /** Source activity location when known; optional (org-wide CRM) */
  locationId?: string;
  customerId: string;
  treatmentId?: string;
  /** Deterministic linkage for Treatment → task idempotency */
  sourceTreatmentId?: string;
  appointmentId?: string;
  assignedStaffId?: string;
  dueAt: string;
  status: FollowUpTaskStatus;
  type: FollowUpTaskType;
  note?: string;
  completionNote?: string;
  context: FollowUpContextSnapshot;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export const FOLLOW_UP_STATUS_LABEL: Record<FollowUpTaskStatus, string> = {
  OPEN: "待追蹤",
  COMPLETED: "已完成",
};

export const FOLLOW_UP_TYPE_LABEL: Record<FollowUpTaskType, string> = {
  TREATMENT_FOLLOW_UP: "療程追蹤",
  REBOOKING: "再預約",
};
