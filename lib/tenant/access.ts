/**
 * Tenant access helpers (application-layer UI boundary).
 *
 * Client-side membership checks are NOT production security.
 * Production authorization is Auth getUser() + staff_auth_memberships + RLS.
 * Never treat activeOrganizationId / a client-supplied organizationId as
 * the only authorization proof. Multi-org users may have several active
 * memberships; UI selection is not a JWT current-org claim.
 */

import { SEED_LOCATIONS, SEED_ORGANIZATIONS } from "@/data/seed-organizations";
import {
  getMembership,
  listAllMemberships,
} from "@/lib/staff-auth/membership-query";
import { getCurrentUserId as resolveCurrentUserId } from "@/lib/staff-auth/identity";
import type { Organization, StaffMembership } from "@/types/saas";

export class OrganizationAccessError extends Error {
  constructor(message = "Access unavailable for this organization") {
    super(message);
    this.name = "OrganizationAccessError";
  }
}

export class LocationAccessError extends Error {
  constructor(message = "Access unavailable for this location") {
    super(message);
    this.name = "LocationAccessError";
  }
}

/** Operational staff-xxx for the signed-in Auth user. Empty when unresolved. Never staff-001 fallback. */
export function getCurrentUserId(): string {
  return resolveCurrentUserId();
}

export function getActiveMembership(
  organizationId: string,
  userId: string,
): StaffMembership | undefined {
  return getMembership(organizationId, userId);
}

/** Application-layer membership gate (mock). Not a security boundary. */
export function canAccessOrganization(userId: string, organizationId: string): boolean {
  if (!organizationId || !userId) return false;
  if (!SEED_ORGANIZATIONS.some((o) => o.id === organizationId)) return false;
  return Boolean(getActiveMembership(organizationId, userId));
}

export function assertCanAccessOrganization(userId: string, organizationId: string): void {
  if (!canAccessOrganization(userId, organizationId)) {
    throw new OrganizationAccessError();
  }
}

export function listAccessibleOrganizations(userId: string): Organization[] {
  if (!userId) return [];
  const allowed = new Set(
    listAllMemberships()
      .filter((m) => m.userId === userId && m.isActive)
      .map((m) => m.organizationId),
  );
  return SEED_ORGANIZATIONS.filter((o) => allowed.has(o.id));
}

/**
 * Resolve a valid organization for the user.
 * Rejects unauthorized / nonexistent persisted ids (fail closed → fallback).
 */
export function resolveAccessibleOrganizationId(
  userId: string,
  preferredOrganizationId?: string | null,
): string | null {
  if (
    preferredOrganizationId &&
    canAccessOrganization(userId, preferredOrganizationId)
  ) {
    return preferredOrganizationId;
  }
  return listAccessibleOrganizations(userId)[0]?.id ?? null;
}

export function canAccessLocation(organizationId: string, locationId: string): boolean {
  return SEED_LOCATIONS.some(
    (l) => l.id === locationId && l.organizationId === organizationId && l.isActive,
  );
}

export function assertCanAccessLocation(organizationId: string, locationId: string): void {
  if (!canAccessLocation(organizationId, locationId)) {
    throw new LocationAccessError();
  }
}

export function assertOrganizationAccess(
  entityOrganizationId: string | undefined | null,
  expectedOrganizationId: string,
): void {
  if (!entityOrganizationId || entityOrganizationId !== expectedOrganizationId) {
    throw new OrganizationAccessError();
  }
}

export function belongsToOrganization(
  entityOrganizationId: string | undefined | null,
  organizationId: string,
): boolean {
  return Boolean(entityOrganizationId && entityOrganizationId === organizationId);
}

/** Stamp organizationId onto entities that may predate tenant fields. */
export function normalizeOrganizationEntity<T extends { organizationId?: string }>(
  entity: T,
  organizationId: string,
): T & { organizationId: string } {
  return {
    ...entity,
    organizationId: entity.organizationId ?? organizationId,
  };
}
