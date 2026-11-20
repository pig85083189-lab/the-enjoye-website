import { hasAppointmentConflict, type ScheduleAppointment } from "@/lib/appointments/domain";
import { getScheduleAppointmentsKey } from "@/lib/tenant/storage-keys";
import type { ProductionStaffAccess } from "@/lib/staff-auth/production-write-access";

const ACTIVE_FUTURE_STATUSES = new Set([
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "IN_SERVICE",
  "pending",
  "in_progress",
]);

export interface InventoryAppointmentInput {
  id: string;
  organizationId: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface InventoryIdentityDirectory {
  remoteCheck: "checked" | "unavailable";
  organizationAppId: string;
  locationAppIds: readonly string[];
  customerAppIds: readonly string[];
  serviceAppIds: readonly string[];
  remoteCheckMessage: string;
  staff: readonly {
    userId: string;
    role: string;
    isActive: boolean;
    access: ProductionStaffAccess;
  }[];
  remoteAppointments: readonly {
    id: string;
    staffId: string;
    startAt: string;
    endAt: string;
    status: string;
  }[];
}

export type InventoryDisposition =
  | "not_future_active"
  | "already_remote"
  | "identity_unresolved"
  | "remote_not_checked"
  | "pending_review";

export interface InventoryRow {
  id: string;
  organizationId: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  endAt: string;
  status: string;
  disposition: InventoryDisposition;
  unresolved: string[];
}

export interface LocalAppointmentInventoryReport {
  readOnly: true;
  writesPerformed: false;
  organizationId: string;
  remoteCheck: "checked" | "unavailable";
  remoteCheckMessage: string;
  rows: InventoryRow[];
  counts: Record<InventoryDisposition, number>;
}

export function acceptInventoryAppointments(
  rows: readonly unknown[],
  organizationId: string,
): InventoryAppointmentInput[] {
  return rows.flatMap((row) => toInventoryAppointment(row, organizationId));
}

export function readPersistedInventoryAppointments(organizationId: string): InventoryAppointmentInput[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getScheduleAppointmentsKey(organizationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return acceptInventoryAppointments(parsed, organizationId);
  } catch {
    return [];
  }
}

export function buildLocalAppointmentInventory(input: {
  organizationId: string;
  now: Date;
  localAppointments: readonly InventoryAppointmentInput[];
  directory: InventoryIdentityDirectory;
}): LocalAppointmentInventoryReport {
  const rows = input.localAppointments
    .filter((item) => item.organizationId === input.organizationId)
    .map((item) => classifyInventoryAppointment(item, input.now, input.directory));
  const counts = {
    not_future_active: 0,
    already_remote: 0,
    identity_unresolved: 0,
    remote_not_checked: 0,
    pending_review: 0,
  };
  for (const row of rows) counts[row.disposition] += 1;
  return {
    readOnly: true,
    writesPerformed: false,
    organizationId: input.organizationId,
    remoteCheck: input.directory.remoteCheck,
    remoteCheckMessage: input.directory.remoteCheckMessage,
    rows,
    counts,
  };
}

export function planAuthorizedAppointmentMigration(input: {
  explicitAuthorization: boolean;
  report: LocalAppointmentInventoryReport;
  remoteAppointments: InventoryIdentityDirectory["remoteAppointments"];
}): {
  writesPerformed: false;
  authorized: boolean;
  readyIds: string[];
  blocked: { id: string; reason: string }[];
} {
  if (!input.explicitAuthorization || input.report.remoteCheck !== "checked") {
    return { writesPerformed: false, authorized: false, readyIds: [], blocked: [] };
  }
  const readyIds: string[] = [];
  const blocked: { id: string; reason: string }[] = [];
  for (const row of input.report.rows) {
    if (row.disposition !== "pending_review") continue;
    const overlap = hasAppointmentConflict(
      {
        id: row.id,
        staffId: row.staffId,
        startAt: row.startAt,
        endAt: row.endAt,
        status: "BOOKED",
      },
      input.remoteAppointments as unknown as ScheduleAppointment[],
    );
    if (overlap) {
      blocked.push({ id: row.id, reason: "remote_overlap" });
      continue;
    }
    readyIds.push(row.id);
  }
  return { writesPerformed: false, authorized: true, readyIds, blocked };
}

function classifyInventoryAppointment(
  item: InventoryAppointmentInput,
  now: Date,
  directory: InventoryIdentityDirectory,
): InventoryRow {
  const base = {
    id: item.id,
    organizationId: item.organizationId,
    locationId: item.locationId,
    customerId: item.customerId,
    serviceId: item.serviceId,
    staffId: item.staffId,
    startAt: item.startAt,
    endAt: item.endAt,
    status: item.status,
  };
  if (!isFutureActive(item, now)) {
    return { ...base, disposition: "not_future_active", unresolved: [] };
  }
  if (directory.remoteCheck !== "checked") {
    return { ...base, disposition: "remote_not_checked", unresolved: [] };
  }
  if (directory.remoteAppointments.some((remote) => remote.id === item.id)) {
    return { ...base, disposition: "already_remote", unresolved: [] };
  }
  const unresolved = unresolvedIdentity(item, directory);
  if (unresolved.length > 0) {
    return { ...base, disposition: "identity_unresolved", unresolved };
  }
  return { ...base, disposition: "pending_review", unresolved: [] };
}

function isFutureActive(item: InventoryAppointmentInput, now: Date): boolean {
  if (!ACTIVE_FUTURE_STATUSES.has(item.status)) return false;
  const start = new Date(item.startAt).getTime();
  return Number.isFinite(start) && start >= now.getTime();
}

function unresolvedIdentity(
  item: InventoryAppointmentInput,
  directory: InventoryIdentityDirectory,
): string[] {
  const missing: string[] = [];
  if (item.organizationId !== directory.organizationAppId) missing.push("organization");
  if (!directory.locationAppIds.includes(item.locationId)) missing.push("location");
  if (!item.customerId || !directory.customerAppIds.includes(item.customerId)) missing.push("customer");
  if (!directory.serviceAppIds.includes(item.serviceId)) missing.push("service");
  const staff = directory.staff.find((row) => row.userId === item.staffId);
  if (!staff?.access.canBeAppointmentStaff) missing.push("staff");
  return missing;
}

function toInventoryAppointment(value: unknown, organizationId: string): InventoryAppointmentInput[] {
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  if (row.organizationId !== organizationId) return [];
  if (typeof row.id !== "string" || typeof row.startAt !== "string" || typeof row.endAt !== "string") {
    return [];
  }
  return [{
    id: row.id,
    organizationId,
    locationId: typeof row.locationId === "string" ? row.locationId : "",
    customerId: typeof row.customerId === "string" ? row.customerId : "",
    serviceId: typeof row.serviceId === "string" ? row.serviceId : "",
    staffId: typeof row.staffId === "string" ? row.staffId : "",
    startAt: row.startAt,
    endAt: row.endAt,
    status: typeof row.status === "string" ? row.status : "",
  }];
}
