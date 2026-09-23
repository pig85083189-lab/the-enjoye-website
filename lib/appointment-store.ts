import type { Appointment, AppointmentStatus } from "@/types";
import {
  applyCompatibilityStatus,
  listAppointments,
  transitionAppointmentStatus,
} from "@/lib/appointments/store";
import { formatHm, normalizeAppointmentStatus, todayBucket } from "@/lib/appointments/domain";
import { migrateLegacyTenantStorage } from "@/lib/tenant/migration";
import { getTenantStorageKey } from "@/lib/tenant/storage-keys";
import { getStoredOrganizationId } from "@/lib/tenant/organization-store";
import { getActiveOrganizationId } from "@/lib/tenant/active-organization";

type StatusMap = Record<string, AppointmentStatus>;

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("enjoye-appointment-change"));
}

function statusKey(organizationId: string): string {
  return getTenantStorageKey(organizationId, "appointment-status");
}

export function getAppointmentStatusMap(organizationId: string): StatusMap {
  if (typeof window === "undefined") return {};
  migrateLegacyTenantStorage(organizationId);
  try {
    const raw = localStorage.getItem(statusKey(organizationId));
    if (!raw) return {};
    return JSON.parse(raw) as StatusMap;
  } catch {
    return {};
  }
}

function toLegacyStatus(status: string): AppointmentStatus {
  const canonical = normalizeAppointmentStatus(status);
  const bucket = todayBucket(canonical);
  if (bucket === "active") return "in_progress";
  if (bucket === "done" || bucket === "muted") return "completed";
  return "pending";
}

/** Compatibility view for existing Today cards. Prefer listAppointments for new UI. */
export function getLiveAppointments(organizationId: string): Appointment[] {
  return listAppointments({ organizationId }).map((item) => ({
    id: item.id,
    organizationId: item.organizationId,
    locationId: item.locationId,
    time: formatHm(new Date(item.startAt)),
    customerId: item.customerId,
    customerName: item.customerName,
    serviceId: item.serviceId,
    serviceName: item.serviceName,
    durationMinutes: item.durationMinutes,
    membership: item.membership ?? "regular",
    // Legacy display residue — never treat as package SoT (use PackageLedger)
    remainingSessions: undefined,
    staffId: item.staffId,
    staffName: item.staffName,
    status: toLegacyStatus(item.status),
    notes: item.notes,
  }));
}

export function setAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
  organizationId: string,
): void {
  if (typeof window === "undefined") return;
  const next = normalizeAppointmentStatus(status);
  try {
    const current = listAppointments({ organizationId }).find((item) => item.id === appointmentId);
    // Today "開始服務" historically jumps pending → in_progress.
    // Canonical path: BOOKED/CONFIRMED → ARRIVED → IN_SERVICE.
    if (
      next === "IN_SERVICE" &&
      current &&
      (current.status === "BOOKED" || current.status === "CONFIRMED")
    ) {
      transitionAppointmentStatus(organizationId, appointmentId, "ARRIVED");
      transitionAppointmentStatus(organizationId, appointmentId, "IN_SERVICE");
      return;
    }
    transitionAppointmentStatus(organizationId, appointmentId, next);
  } catch {
    migrateLegacyTenantStorage(organizationId);
    const map = getAppointmentStatusMap(organizationId);
    map[appointmentId] = status;
    localStorage.setItem(statusKey(organizationId), JSON.stringify(map));
    applyCompatibilityStatus(organizationId, appointmentId, next);
    emit();
  }
}

export function getAppointmentById(
  id: string,
  organizationId: string,
): Appointment | undefined {
  return getLiveAppointments(organizationId).find((item) => item.id === id);
}

export function findAppointmentForCustomer(
  customerId: string,
  organizationId: string,
): Appointment | undefined {
  const live = getLiveAppointments(organizationId);
  return (
    live.find((item) => item.customerId === customerId && item.status !== "completed") ??
    live.find((item) => item.customerId === customerId)
  );
}

export function getAppointmentStatusRaw(): string {
  if (typeof window === "undefined") return "";
  // Prefer persisted org pointer to avoid Enjoye default flash on tenant switch
  const orgId = getStoredOrganizationId() ?? getActiveOrganizationId();
  return `${orgId}|${localStorage.getItem(statusKey(orgId)) ?? ""}|${localStorage.getItem(`beauty-os:${orgId}:schedule-appointments:v1`) ?? ""}`;
}

export function subscribeAppointments(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener("enjoye-appointment-change", handler);
  window.addEventListener("beauty-os-organization-change", handler);
  window.addEventListener("enjoye-crm-change", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("enjoye-appointment-change", handler);
    window.removeEventListener("beauty-os-organization-change", handler);
    window.removeEventListener("enjoye-crm-change", handler);
  };
}

export const APPOINTMENT_STATUS_KEY = "the-enjoye:appointment-status";
