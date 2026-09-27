/**
 * Canonical FollowUpTask store — Phase 4.11C.
 * Tenant-scoped localStorage; features must not touch storage directly.
 */

import { getServiceById } from "@/data/mock-services";
import { getCustomerById } from "@/data/mock-customers";
import {
  combineLocalDateTime,
  formatYmd,
} from "@/lib/appointments/domain";
import { getFollowUpTasksKey } from "@/lib/tenant/storage-keys";
import { getMembership } from "@/lib/tenant/organization-store";
import type { TreatmentDraft, TreatmentFollowUp } from "@/types/treatment";
import type {
  FollowUpTask,
  FollowUpTaskType,
} from "./domain";

const CHANGE = "beauty-os-follow-up-change";

function emit(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("beauty-os:follow-up-rev", String(Date.now()));
  window.dispatchEvent(new Event(CHANGE));
}

function readAll(organizationId: string): FollowUpTask[] {
  if (typeof window === "undefined") return [];
  if (!organizationId) throw new Error("organizationId is required");
  try {
    const raw = localStorage.getItem(getFollowUpTasksKey(organizationId));
    if (!raw) return [];
    return (JSON.parse(raw) as FollowUpTask[]).filter(
      (t) => t.organizationId === organizationId,
    );
  } catch {
    return [];
  }
}

function writeAll(organizationId: string, list: FollowUpTask[]): void {
  if (typeof window === "undefined") return;
  if (!organizationId) throw new Error("organizationId is required");
  localStorage.setItem(
    getFollowUpTasksKey(organizationId),
    JSON.stringify(list.filter((t) => t.organizationId === organizationId)),
  );
  emit();
}

function assertOrgStaff(organizationId: string, staffId: string): void {
  const m = getMembership(organizationId, staffId);
  if (!m) {
    throw new Error("Staff membership does not belong to this organization");
  }
}

function resolveAssignee(
  organizationId: string,
  staffId: string | undefined,
): string | undefined {
  if (!staffId) return undefined;
  const m = getMembership(organizationId, staffId);
  return m ? staffId : undefined;
}

export function treatmentHasFollowUpIntent(followUp: TreatmentFollowUp): boolean {
  return (
    followUp.tags.length > 0 ||
    followUp.suggestedDate.trim().length > 0 ||
    followUp.note.trim().length > 0 ||
    followUp.suggestNextBooking
  );
}

export function resolveFollowUpType(followUp: TreatmentFollowUp): FollowUpTaskType {
  return followUp.suggestNextBooking ? "REBOOKING" : "TREATMENT_FOLLOW_UP";
}

/** Map Treatment suggestedDate (YYYY-MM-DD) → dueAt ISO; default +7 local days @ 10:00. */
export function resolveDueAtFromFollowUp(
  followUp: TreatmentFollowUp,
  now: Date = new Date(),
): string {
  const date = followUp.suggestedDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return combineLocalDateTime(date, "10:00").toISOString();
  }
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 7);
  return combineLocalDateTime(formatYmd(fallback), "10:00").toISOString();
}

export function deterministicFollowUpIdFromTreatment(
  treatmentId: string,
): string {
  return `fu-treatment-${treatmentId}`;
}

export function listFollowUpTasks(organizationId: string): FollowUpTask[] {
  return readAll(organizationId).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function getFollowUpTask(
  organizationId: string,
  taskId: string,
): FollowUpTask | undefined {
  return readAll(organizationId).find((t) => t.id === taskId);
}

export function listFollowUpTasksForCustomer(
  organizationId: string,
  customerId: string,
): FollowUpTask[] {
  return listFollowUpTasks(organizationId).filter(
    (t) => t.customerId === customerId,
  );
}

export function getFollowUpBySourceTreatment(
  organizationId: string,
  treatmentId: string,
): FollowUpTask | undefined {
  return readAll(organizationId).find(
    (t) => t.sourceTreatmentId === treatmentId,
  );
}

/**
 * Idempotent: one FollowUpTask per completed Treatment with follow-up intent.
 * Safe to call on refresh / re-complete / resume.
 */
export function ensureFollowUpTaskFromCompletedTreatment(
  treatment: TreatmentDraft,
  now: Date = new Date(),
): FollowUpTask | null {
  if (!treatment.organizationId) {
    throw new Error("Treatment.organizationId is required");
  }
  const organizationId = treatment.organizationId;
  if (treatment.status !== "completed") return null;
  if (!treatmentHasFollowUpIntent(treatment.followUp)) return null;

  const existing = getFollowUpBySourceTreatment(organizationId, treatment.id);
  if (existing) return existing;

  const customer = getCustomerById(treatment.customerId, organizationId);
  const service = getServiceById(treatment.serviceId, organizationId);
  const staff = resolveAssignee(organizationId, treatment.staffId);
  const staffMembership = staff
    ? getMembership(organizationId, staff)
    : undefined;

  const nowIso = now.toISOString();
  const task: FollowUpTask = {
    id: deterministicFollowUpIdFromTreatment(treatment.id),
    organizationId,
    locationId: treatment.locationId,
    customerId: treatment.customerId,
    treatmentId: treatment.id,
    sourceTreatmentId: treatment.id,
    appointmentId: treatment.appointmentId || undefined,
    assignedStaffId: staff,
    dueAt: resolveDueAtFromFollowUp(treatment.followUp, now),
    status: "OPEN",
    type: resolveFollowUpType(treatment.followUp),
    note: treatment.followUp.note.trim() || undefined,
    context: {
      customerName: customer?.name,
      serviceId: treatment.serviceId,
      serviceName: service?.name,
      staffName: staffMembership?.displayName,
      followUpTags: [...treatment.followUp.tags],
      treatmentNote: treatment.followUp.note.trim() || undefined,
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const list = readAll(organizationId);
  // Guard same deterministic id collision
  if (list.some((t) => t.id === task.id)) return list.find((t) => t.id === task.id)!;
  writeAll(organizationId, [task, ...list]);
  return task;
}

export function completeFollowUpTask(
  organizationId: string,
  taskId: string,
  input: { actorStaffId: string; completionNote?: string },
): FollowUpTask {
  assertOrgStaff(organizationId, input.actorStaffId);
  const list = readAll(organizationId);
  const idx = list.findIndex((t) => t.id === taskId);
  if (idx < 0) throw new Error("Follow-up task not found");
  const current = list[idx];
  if (current.organizationId !== organizationId) {
    throw new Error("Follow-up task not found");
  }
  const now = new Date().toISOString();
  const next: FollowUpTask = {
    ...current,
    status: "COMPLETED",
    completionNote: input.completionNote?.trim() || current.completionNote,
    completedAt: current.completedAt ?? now,
    updatedAt: now,
  };
  const copy = [...list];
  copy[idx] = next;
  writeAll(organizationId, copy);
  return next;
}

/**
 * Snooze = keep OPEN, move dueAt.
 * Avoids a separate SNOOZED status that complicates selectors.
 */
export function snoozeFollowUpTask(
  organizationId: string,
  taskId: string,
  input: { actorStaffId: string; dueAt: string },
): FollowUpTask {
  assertOrgStaff(organizationId, input.actorStaffId);
  const due = new Date(input.dueAt);
  if (Number.isNaN(due.getTime())) {
    throw new Error("Invalid dueAt");
  }
  const list = readAll(organizationId);
  const idx = list.findIndex((t) => t.id === taskId);
  if (idx < 0) throw new Error("Follow-up task not found");
  const current = list[idx];
  if (current.organizationId !== organizationId) {
    throw new Error("Follow-up task not found");
  }
  if (current.status === "COMPLETED") {
    throw new Error("Cannot snooze a completed follow-up");
  }
  const next: FollowUpTask = {
    ...current,
    dueAt: due.toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const copy = [...list];
  copy[idx] = next;
  writeAll(organizationId, copy);
  return next;
}

export function getFollowUpRevision(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("beauty-os:follow-up-rev") ?? "";
}

export function subscribeFollowUps(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onChange();
  window.addEventListener(CHANGE, handler);
  window.addEventListener("storage", handler);
  window.addEventListener("beauty-os-organization-change", handler);
  return () => {
    window.removeEventListener(CHANGE, handler);
    window.removeEventListener("storage", handler);
    window.removeEventListener("beauty-os-organization-change", handler);
  };
}

/** Calendar rebook URL — reuses existing create appointment dialog via query prefill */
export function buildRebookHref(task: FollowUpTask): string {
  const params = new URLSearchParams({ create: "1", customer: task.customerId });
  if (task.context.serviceId) params.set("service", task.context.serviceId);
  if (task.assignedStaffId) params.set("staff", task.assignedStaffId);
  params.set("followUp", task.id);
  return `/staff/calendar?${params.toString()}`;
}
