/**
 * Canonical Service catalog store — seed + overlay.
 *
 * Public read API remains getServiceById / getServicesForOrganization
 * (re-exported from data/mock-services). This is not a second catalog.
 */

import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { getSeedServicesForOrganization } from "@/data/service-seed";
import { assertNonNegativeMoney } from "@/lib/commerce/money";
import { newId } from "@/lib/repositories/storage";
import { getTenantStorageKey } from "@/lib/tenant/storage-keys";
import type { StaffRole } from "@/types/saas";
import type { Service } from "@/types";
import type { TreatmentServiceType } from "@/types/treatment-template";

const CHANGE = "enjoye-commerce-change";

const SERVICE_MANAGE_ROLES: ReadonlySet<StaffRole> = new Set(["OWNER", "MANAGER"]);

export interface CreateServiceInput {
  name: string;
  category?: string;
  durationMinutes: number;
  priceMinor: number;
  isActive?: boolean;
  serviceType?: TreatmentServiceType;
  createdByStaffId: string;
}

export type ServiceUpdatePatch = Partial<{
  name: string;
  category: string | null;
  durationMinutes: number;
  priceMinor: number;
  isActive: boolean;
}>;

function emit(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("beauty-os:commerce-rev", String(Date.now()));
  window.dispatchEvent(new Event(CHANGE));
}

function overlayKey(organizationId: string): string {
  return getTenantStorageKey(organizationId, "services");
}

function readOverlay(organizationId: string): Service[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(overlayKey(organizationId));
    if (!raw) return [];
    return (JSON.parse(raw) as Service[]).filter(
      (row) => row.organizationId === organizationId && typeof row.id === "string",
    );
  } catch {
    return [];
  }
}

function writeOverlay(organizationId: string, list: Service[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    overlayKey(organizationId),
    JSON.stringify(list.filter((row) => row.organizationId === organizationId)),
  );
  emit();
}

export function isServiceActive(service: Pick<Service, "isActive"> | undefined): boolean {
  return service?.isActive !== false;
}

function normalizeService(row: Service): Service {
  return {
    ...row,
    name: row.name,
    durationMinutes: row.durationMinutes,
    category: row.category ?? "",
    serviceType: row.serviceType ?? "GENERIC",
    isActive: isServiceActive(row),
  };
}

function mergeCatalog(organizationId: string): Service[] {
  const seeds = getSeedServicesForOrganization(organizationId).map(normalizeService);
  const overlay = readOverlay(organizationId).map(normalizeService);
  const byId = new Map<string, Service>();
  for (const seed of seeds) {
    byId.set(seed.id, seed);
  }
  const extras: Service[] = [];
  for (const row of overlay) {
    if (row.organizationId !== organizationId) continue;
    const existing = byId.get(row.id);
    if (existing) {
      byId.set(row.id, {
        ...existing,
        ...row,
        id: existing.id,
        organizationId,
        serviceType: existing.serviceType,
      });
    } else {
      extras.push({ ...row, organizationId, serviceType: row.serviceType ?? "GENERIC" });
    }
  }
  return [...extras, ...seeds.map((seed) => byId.get(seed.id)!)].map(normalizeService);
}

export function listServices(
  organizationId: string,
  opts?: { activeOnly?: boolean },
): Service[] {
  let list = mergeCatalog(organizationId).filter(
    (row) => row.organizationId === organizationId,
  );
  if (opts?.activeOnly) list = list.filter((row) => isServiceActive(row));
  return list;
}

/** Tenant-owned service catalog — always organization scoped. */
export function getServicesForOrganization(
  organizationId: string,
  opts?: { activeOnly?: boolean },
): Service[] {
  return listServices(organizationId, opts);
}

/**
 * Tenant-owned service lookup. organizationId is required.
 * Inactive services still resolve so historical joins keep their identity.
 */
export function getServiceById(
  id: string,
  organizationId: string,
): Service | undefined {
  return listServices(organizationId).find((service) => service.id === id);
}

function assertStaff(organizationId: string, staffId: string) {
  const membership = SEED_MEMBERSHIPS.find(
    (item) =>
      item.organizationId === organizationId &&
      item.userId === staffId &&
      item.isActive,
  );
  if (!membership) throw new Error("Staff membership does not belong to this organization");
  return membership;
}

function assertCanManage(organizationId: string, staffId: string): void {
  const membership = assertStaff(organizationId, staffId);
  if (!SERVICE_MANAGE_ROLES.has(membership.role)) {
    throw new Error("Unauthorized to manage services");
  }
}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("service name required");
  return trimmed;
}

function assertDuration(durationMinutes: number): number {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("durationMinutes must be an integer > 0");
  }
  return durationMinutes;
}

export function createService(
  organizationId: string,
  input: CreateServiceInput,
): Service {
  assertCanManage(organizationId, input.createdByStaffId);
  const name = assertName(input.name);
  const durationMinutes = assertDuration(input.durationMinutes);
  assertNonNegativeMoney(input.priceMinor, "priceMinor");
  const row: Service = {
    id: newId("svc"),
    organizationId,
    name,
    durationMinutes,
    category: input.category?.trim() ?? "",
    serviceType: input.serviceType ?? "GENERIC",
    priceMinor: input.priceMinor,
    isActive: input.isActive !== false,
  };
  const overlay = readOverlay(organizationId);
  if (overlay.some((item) => item.id === row.id) || getServiceById(row.id, organizationId)) {
    throw new Error("Service id collision");
  }
  writeOverlay(organizationId, [row, ...overlay]);
  return normalizeService(row);
}

export function updateService(
  organizationId: string,
  serviceId: string,
  patch: ServiceUpdatePatch,
  actorStaffId: string,
): Service {
  assertCanManage(organizationId, actorStaffId);
  const existing = getServiceById(serviceId, organizationId);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Service not found");
  }
  const nextName = patch.name !== undefined ? assertName(patch.name) : existing.name;
  const nextDuration =
    patch.durationMinutes !== undefined
      ? assertDuration(patch.durationMinutes)
      : existing.durationMinutes;
  const nextPrice =
    patch.priceMinor !== undefined
      ? assertNonNegativeMoney(patch.priceMinor, "priceMinor")
      : existing.priceMinor;
  const updated: Service = {
    ...existing,
    id: existing.id,
    organizationId,
    name: nextName,
    durationMinutes: nextDuration,
    category:
      patch.category === null
        ? ""
        : patch.category !== undefined
          ? patch.category.trim()
          : existing.category,
    priceMinor: nextPrice,
    isActive: patch.isActive ?? existing.isActive,
    serviceType: existing.serviceType,
  };
  const overlay = readOverlay(organizationId).filter((row) => row.id !== serviceId);
  writeOverlay(organizationId, [updated, ...overlay]);
  return normalizeService(updated);
}

export function deactivateService(
  organizationId: string,
  serviceId: string,
  actorStaffId: string,
): Service {
  return updateService(organizationId, serviceId, { isActive: false }, actorStaffId);
}

export function reactivateService(
  organizationId: string,
  serviceId: string,
  actorStaffId: string,
): Service {
  return updateService(organizationId, serviceId, { isActive: true }, actorStaffId);
}

export function canActorManageServices(
  organizationId: string,
  actorStaffId: string,
): boolean {
  const membership = SEED_MEMBERSHIPS.find(
    (item) =>
      item.organizationId === organizationId &&
      item.userId === actorStaffId &&
      item.isActive,
  );
  return Boolean(membership && SERVICE_MANAGE_ROLES.has(membership.role));
}
