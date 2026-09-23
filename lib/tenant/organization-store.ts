import type { Organization, Location, StaffMembership, OrganizationSubscription } from "@/types/saas";
import {
  CURRENT_ORG_STORAGE_KEY,
  LOCATION_OVERRIDES_STORAGE_KEY,
  ORG_ENJOYE_ID,
  ORG_OVERRIDES_STORAGE_KEY,
} from "@/lib/tenant/constants";
import {
  SEED_LOCATIONS,
  SEED_MEMBERSHIPS,
  SEED_ORGANIZATIONS,
  SEED_SUBSCRIPTIONS,
} from "@/data/seed-organizations";
import { setActiveOrganizationId } from "@/lib/tenant/active-organization";
import { migrateLegacyTenantStorage } from "@/lib/tenant/migration";
import { emitCrmChange } from "@/lib/repositories/keys";
import {
  canAccessLocation,
  canAccessOrganization,
  getCurrentUserId,
  listAccessibleOrganizations,
  resolveAccessibleOrganizationId,
} from "@/lib/tenant/access";
import {
  getCurrentLocationStorageKey,
  LEGACY_GLOBAL_LOCATION_KEY,
} from "@/lib/tenant/storage-keys";

const ORG_CHANGE_EVENT = "beauty-os-organization-change";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function listOrganizations(): Organization[] {
  const overrides = readJson<Record<string, Partial<Organization>>>(ORG_OVERRIDES_STORAGE_KEY, {});
  return SEED_ORGANIZATIONS.map((org) => ({ ...org, ...overrides[org.id] }));
}

export function listOrganizationsForUser(userId: string): Organization[] {
  const overrides = readJson<Record<string, Partial<Organization>>>(ORG_OVERRIDES_STORAGE_KEY, {});
  return listAccessibleOrganizations(userId).map((org) => ({
    ...org,
    ...overrides[org.id],
  }));
}

export function getOrganizationById(id: string): Organization | undefined {
  return listOrganizations().find((o) => o.id === id);
}

export function updateOrganizationLocal(
  organizationId: string,
  patch: Partial<Organization>,
): Organization | undefined {
  const current = getOrganizationById(organizationId);
  if (!current) return undefined;
  const overrides = readJson<Record<string, Partial<Organization>>>(ORG_OVERRIDES_STORAGE_KEY, {});
  overrides[organizationId] = {
    ...overrides[organizationId],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeJson(ORG_OVERRIDES_STORAGE_KEY, overrides);
  emitOrgChange();
  return getOrganizationById(organizationId);
}

export function listLocations(organizationId: string): Location[] {
  const overrides = readJson<Record<string, Partial<Location>>>(LOCATION_OVERRIDES_STORAGE_KEY, {});
  return SEED_LOCATIONS.filter((l) => l.organizationId === organizationId).map((loc) => ({
    ...loc,
    ...overrides[loc.id],
  }));
}

export function getPrimaryLocation(organizationId: string): Location | undefined {
  const locations = listLocations(organizationId);
  return locations.find((l) => l.isPrimary) ?? locations[0];
}

export function updateLocationLocal(
  locationId: string,
  patch: Partial<Location>,
): Location | undefined {
  const all = SEED_LOCATIONS.find((l) => l.id === locationId);
  if (!all) return undefined;
  const overrides = readJson<Record<string, Partial<Location>>>(LOCATION_OVERRIDES_STORAGE_KEY, {});
  overrides[locationId] = {
    ...overrides[locationId],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeJson(LOCATION_OVERRIDES_STORAGE_KEY, overrides);
  emitOrgChange();
  return listLocations(all.organizationId).find((l) => l.id === locationId);
}

export function getMembership(
  organizationId: string,
  userId: string,
): StaffMembership | undefined {
  return SEED_MEMBERSHIPS.find(
    (m) => m.organizationId === organizationId && m.userId === userId && m.isActive,
  );
}

export function getSubscription(organizationId: string): OrganizationSubscription | undefined {
  return SEED_SUBSCRIPTIONS.find((s) => s.organizationId === organizationId);
}

function readRawStoredOrganizationId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CURRENT_ORG_STORAGE_KEY);
}

/**
 * Idempotent migration: legacy global location → org-scoped key when ownership matches.
 * Always clears the global key after evaluation so org A cannot pollute org B.
 */
export function migrateLegacyLocationPointer(organizationId: string): void {
  if (typeof window === "undefined") return;
  const legacy = window.localStorage.getItem(LEGACY_GLOBAL_LOCATION_KEY);
  if (legacy === null) return;

  const scopedKey = getCurrentLocationStorageKey(organizationId);
  const existing = window.localStorage.getItem(scopedKey);
  if (existing === null && canAccessLocation(organizationId, legacy)) {
    window.localStorage.setItem(scopedKey, legacy);
  }
  window.localStorage.removeItem(LEGACY_GLOBAL_LOCATION_KEY);
}

export function readPersistedLocationId(organizationId: string): string | null {
  if (typeof window === "undefined") return null;
  migrateLegacyLocationPointer(organizationId);
  return window.localStorage.getItem(getCurrentLocationStorageKey(organizationId));
}

/**
 * Resolve current location for an organization. Invalid / cross-org ids are rejected.
 * Never temporarily returns another org's location.
 */
export function resolveCurrentLocation(organizationId: string): Location | undefined {
  const locations = listLocations(organizationId);
  const primary = locations.find((l) => l.isPrimary) ?? locations[0];
  const persisted = readPersistedLocationId(organizationId);
  if (persisted && locations.some((l) => l.id === persisted)) {
    return locations.find((l) => l.id === persisted);
  }
  if (persisted && typeof window !== "undefined") {
    window.localStorage.removeItem(getCurrentLocationStorageKey(organizationId));
  }
  return primary;
}

/**
 * Persist location only when it belongs to the organization. Returns false if rejected.
 */
export function persistCurrentLocation(
  organizationId: string,
  locationId: string,
): boolean {
  if (typeof window === "undefined") return false;
  if (!canAccessLocation(organizationId, locationId)) return false;
  window.localStorage.setItem(getCurrentLocationStorageKey(organizationId), locationId);
  emitOrgChange();
  return true;
}

/**
 * Validated stored organization for the current user.
 * Unauthorized / nonexistent values are cleared and replaced with an accessible fallback.
 */
export function getStoredOrganizationId(userId = getCurrentUserId()): string | null {
  if (typeof window === "undefined") {
    return resolveAccessibleOrganizationId(userId, ORG_ENJOYE_ID);
  }
  const raw = readRawStoredOrganizationId();
  const resolved = resolveAccessibleOrganizationId(userId, raw);
  if (raw && raw !== resolved) {
    if (resolved) {
      window.localStorage.setItem(CURRENT_ORG_STORAGE_KEY, resolved);
    } else {
      window.localStorage.removeItem(CURRENT_ORG_STORAGE_KEY);
    }
  }
  return resolved;
}

/**
 * Persist organization only when the user has an active membership.
 * Returns false and does not write when unauthorized / nonexistent.
 */
export function persistOrganizationId(
  organizationId: string,
  userId = getCurrentUserId(),
): boolean {
  if (typeof window === "undefined") return false;
  if (!canAccessOrganization(userId, organizationId)) return false;
  window.localStorage.setItem(CURRENT_ORG_STORAGE_KEY, organizationId);
  setActiveOrganizationId(organizationId);
  migrateLegacyTenantStorage(organizationId);
  migrateLegacyLocationPointer(organizationId);
  emitOrgChange();
  emitCrmChange("organization-switch");
  return true;
}

export function bootstrapOrganizationContext(userId = getCurrentUserId()): string | null {
  const id = getStoredOrganizationId(userId);
  if (id) {
    setActiveOrganizationId(id);
    migrateLegacyTenantStorage(id);
    migrateLegacyLocationPointer(id);
  }
  return id;
}

export function emitOrgChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ORG_CHANGE_EVENT));
}

export function subscribeOrganization(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  bootstrapOrganizationContext();
  const handler = () => onChange();
  window.addEventListener(ORG_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(ORG_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function getOrganizationSnapshot(): string {
  if (typeof window === "undefined") return ORG_ENJOYE_ID;
  const orgId = getStoredOrganizationId() ?? "none";
  const locationPtr =
    orgId === "none"
      ? ""
      : (window.localStorage.getItem(getCurrentLocationStorageKey(orgId)) ?? "");
  return `${orgId}|${window.localStorage.getItem(ORG_OVERRIDES_STORAGE_KEY) ?? ""}|${window.localStorage.getItem(LOCATION_OVERRIDES_STORAGE_KEY) ?? ""}|${locationPtr}`;
}
