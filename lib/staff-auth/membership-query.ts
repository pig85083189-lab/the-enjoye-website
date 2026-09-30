/**
 * Canonical StaffMembership reads (seed + overlay + optional remote hydrate).
 * Not a second staff store — extracted so access/auth can resolve without cycles.
 */
import { SEED_MEMBERSHIPS, SEED_ORGANIZATIONS } from "@/data/seed-organizations";
import {
  MEMBERSHIP_ENJOYE_OWNER_ID,
  MEMBERSHIP_OVERRIDES_STORAGE_KEY,
} from "@/lib/tenant/constants";
import { ownerBootstrapAuthUserId } from "@/lib/supabase/env";
import {
  assertOperationalStaffId,
  isAuthUuid,
} from "@/lib/staff-auth/staff-id";
import type { StaffMembership } from "@/types/saas";

export { assertOperationalStaffId, isAuthUuid };

let hydratedRemote: Record<string, StaffMembership> = {};

export function hydrateRemoteMemberships(rows: StaffMembership[]): void {
  const next: Record<string, StaffMembership> = { ...hydratedRemote };
  for (const row of rows) {
    assertOperationalStaffId(row.userId);
    next[row.id] = {
      ...row,
      locationIds: [...row.locationIds],
    };
  }
  hydratedRemote = next;
}

export function resetHydratedRemoteMembershipsForTests(): void {
  hydratedRemote = {};
}

/** Login hydrate: remote rows become readable on this device without a second store. */
export function applyRemoteMembershipsToClient(rows: StaffMembership[]): void {
  hydrateRemoteMemberships(rows);
  if (typeof window === "undefined") return;
  const overrides = readOverrides();
  for (const row of rows) {
    assertOperationalStaffId(row.userId);
    const current = overrides[row.id];
    overrides[row.id] = {
      ...row,
      id: row.id,
      userId: current?.userId ?? row.userId,
      organizationId: row.organizationId,
      authUserId: current?.authUserId || row.authUserId || null,
      locationIds: row.locationIds.length
        ? [...row.locationIds]
        : [...(current?.locationIds ?? [])],
    };
  }
  window.localStorage.setItem(
    MEMBERSHIP_OVERRIDES_STORAGE_KEY,
    JSON.stringify(overrides),
  );
}

function readOverrides(): Record<string, StaffMembership> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MEMBERSHIP_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, StaffMembership>;
  } catch {
    return {};
  }
}

function applyBootstrapAuthUserId(row: StaffMembership): StaffMembership {
  if (row.authUserId) return row;
  const bootstrap = ownerBootstrapAuthUserId();
  if (!bootstrap) return row;
  if (row.id !== MEMBERSHIP_ENJOYE_OWNER_ID) return row;
  return { ...row, authUserId: bootstrap };
}

function mergeMembershipSources(
  seed: StaffMembership | undefined,
  remote: StaffMembership | undefined,
  overlay: StaffMembership | undefined,
): StaffMembership {
  const identity = seed ?? overlay ?? remote;
  if (!identity) {
    throw new Error("membership identity missing");
  }
  const merged: StaffMembership = {
    ...identity,
    ...seed,
    ...remote,
    ...overlay,
    id: identity.id,
    userId: seed?.userId ?? overlay?.userId ?? remote?.userId ?? identity.userId,
    organizationId:
      seed?.organizationId ??
      overlay?.organizationId ??
      remote?.organizationId ??
      identity.organizationId,
    role: overlay?.role ?? remote?.role ?? seed?.role ?? identity.role,
    displayName:
      overlay?.displayName ??
      remote?.displayName ??
      seed?.displayName ??
      identity.displayName,
    createdAt:
      overlay?.createdAt ?? remote?.createdAt ?? seed?.createdAt ?? identity.createdAt,
    locationIds: [
      ...(overlay?.locationIds ?? remote?.locationIds ?? seed?.locationIds ?? []),
    ],
    authUserId:
      overlay?.authUserId ||
      remote?.authUserId ||
      seed?.authUserId ||
      null,
    isActive: overlay?.isActive ?? remote?.isActive ?? seed?.isActive ?? true,
    email: overlay?.email ?? remote?.email ?? seed?.email ?? identity.email ?? null,
  };
  assertOperationalStaffId(merged.userId);
  return applyBootstrapAuthUserId(merged);
}

export function listMemberships(organizationId: string): StaffMembership[] {
  const overrides = readOverrides();
  const remote = hydratedRemote;
  const ids = new Set<string>();
  for (const row of SEED_MEMBERSHIPS) {
    if (row.organizationId === organizationId) ids.add(row.id);
  }
  for (const row of Object.values(overrides)) {
    if (row.organizationId === organizationId) ids.add(row.id);
  }
  for (const row of Object.values(remote)) {
    if (row.organizationId === organizationId) ids.add(row.id);
  }
  return [...ids].map((id) =>
    mergeMembershipSources(
      SEED_MEMBERSHIPS.find(
        (item) => item.id === id && item.organizationId === organizationId,
      ),
      remote[id]?.organizationId === organizationId ? remote[id] : undefined,
      overrides[id]?.organizationId === organizationId ? overrides[id] : undefined,
    ),
  );
}

export function listAllMemberships(): StaffMembership[] {
  const ids = SEED_ORGANIZATIONS.map((org) => org.id);
  const extraOrgs = new Set<string>([
    ...Object.values(readOverrides()).map((item) => item.organizationId),
    ...Object.values(hydratedRemote).map((item) => item.organizationId),
  ]);
  for (const id of extraOrgs) ids.push(id);
  const seen = new Set<string>();
  const rows: StaffMembership[] = [];
  for (const organizationId of ids) {
    if (seen.has(organizationId)) continue;
    seen.add(organizationId);
    rows.push(...listMemberships(organizationId));
  }
  return rows;
}

export function getMembership(
  organizationId: string,
  userId: string,
): StaffMembership | undefined {
  return listMemberships(organizationId).find(
    (item) => item.userId === userId && item.isActive,
  );
}

export function listMembershipsForAuthUser(
  authUserId: string,
  opts?: { activeOnly?: boolean },
): StaffMembership[] {
  if (!authUserId) return [];
  const activeOnly = opts?.activeOnly !== false;
  return listAllMemberships().filter((item) => {
    if (item.authUserId !== authUserId) return false;
    if (activeOnly && !item.isActive) return false;
    return true;
  });
}

export function deriveStaffLoginBinding(
  membership: Pick<StaffMembership, "authUserId">,
): "unbound" | "bound" {
  return membership.authUserId ? "bound" : "unbound";
}
