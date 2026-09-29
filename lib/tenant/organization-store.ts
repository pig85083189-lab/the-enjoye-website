import type {
  Location,
  Organization,
  OrganizationSubscription,
  StaffMembership,
  StaffRole,
} from "@/types/saas";
import {
  CURRENT_ORG_STORAGE_KEY,
  LOCATION_OVERRIDES_STORAGE_KEY,
  MEMBERSHIP_OVERRIDES_STORAGE_KEY,
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
import { newId } from "@/lib/repositories/storage";
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

const STAFF_ROLES: StaffRole[] = [
  "OWNER",
  "MANAGER",
  "STAFF",
  "RECEPTIONIST",
  "ACCOUNTANT",
];

function readMembershipOverrides(): Record<string, StaffMembership> {
  return readJson<Record<string, StaffMembership>>(MEMBERSHIP_OVERRIDES_STORAGE_KEY, {});
}

function writeMembershipOverrides(value: Record<string, StaffMembership>): void {
  writeJson(MEMBERSHIP_OVERRIDES_STORAGE_KEY, value);
}

function isStaffRole(value: string): value is StaffRole {
  return STAFF_ROLES.includes(value as StaffRole);
}

/** All org memberships, including inactive. Canonical StaffMembership read — not a parallel roster. */
export function listMemberships(organizationId: string): StaffMembership[] {
  const overrides = readMembershipOverrides();
  const seeded = SEED_MEMBERSHIPS.filter((item) => item.organizationId === organizationId).map(
    (item) => {
      const patch = overrides[item.id];
      return patch ? { ...item, ...patch, id: item.id, userId: item.userId, organizationId: item.organizationId } : item;
    },
  );
  const seededIds = new Set(seeded.map((item) => item.id));
  const created = Object.values(overrides).filter(
    (item) => item.organizationId === organizationId && !seededIds.has(item.id),
  );
  return [...seeded, ...created];
}

export function getMembership(
  organizationId: string,
  userId: string,
): StaffMembership | undefined {
  return listMemberships(organizationId).find(
    (item) => item.userId === userId && item.isActive,
  );
}

export interface CreateMembershipInput {
  organizationId: string;
  displayName: string;
  role: StaffRole;
  locationIds: string[];
}

export function createMembership(input: CreateMembershipInput): StaffMembership {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("displayName is required");
  if (!isStaffRole(input.role)) throw new Error("role is not a canonical StaffRole");
  const locations = listLocations(input.organizationId);
  const locationIds = [...new Set(input.locationIds)];
  if (locationIds.length === 0) throw new Error("at least one location is required");
  if (locationIds.some((id) => !locations.some((location) => location.id === id))) {
    throw new Error("location does not belong to this organization");
  }
  const membership: StaffMembership = {
    id: newId("mem"),
    organizationId: input.organizationId,
    userId: newId("staff"),
    locationIds,
    role: input.role,
    displayName,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  const overrides = readMembershipOverrides();
  overrides[membership.id] = membership;
  writeMembershipOverrides(overrides);
  emitOrgChange();
  return membership;
}

export function updateMembership(
  organizationId: string,
  membershipId: string,
  patch: Partial<Pick<StaffMembership, "displayName" | "role" | "locationIds" | "isActive">>,
): StaffMembership {
  const current = listMemberships(organizationId).find((item) => item.id === membershipId);
  if (!current) throw new Error("Staff membership not found");
  const displayName =
    patch.displayName === undefined ? current.displayName : patch.displayName.trim();
  if (!displayName) throw new Error("displayName is required");
  const role = patch.role ?? current.role;
  if (!isStaffRole(role)) throw new Error("role is not a canonical StaffRole");
  const locationIds = patch.locationIds
    ? [...new Set(patch.locationIds)]
    : current.locationIds;
  if (locationIds.length === 0) throw new Error("at least one location is required");
  const locations = listLocations(organizationId);
  if (locationIds.some((id) => !locations.some((location) => location.id === id))) {
    throw new Error("location does not belong to this organization");
  }
  const next: StaffMembership = {
    ...current,
    displayName,
    role,
    locationIds,
    isActive: patch.isActive ?? current.isActive,
  };
  const overrides = readMembershipOverrides();
  overrides[next.id] = next;
  writeMembershipOverrides(overrides);
  emitOrgChange();
  return next;
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
  return `${orgId}|${window.localStorage.getItem(ORG_OVERRIDES_STORAGE_KEY) ?? ""}|${window.localStorage.getItem(LOCATION_OVERRIDES_STORAGE_KEY) ?? ""}|${window.localStorage.getItem(MEMBERSHIP_OVERRIDES_STORAGE_KEY) ?? ""}|${locationPtr}`;
}
