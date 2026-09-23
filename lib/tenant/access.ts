/**
 * Tenant access helpers (application-layer boundary).
 *
 * Prototype only: client-side membership checks are NOT production security.
 * Future production must enforce Auth + server authorization + Postgres RLS.
 * Never treat a client-supplied organizationId as authorization proof.
 */

import { SEED_LOCATIONS, SEED_MEMBERSHIPS, SEED_ORGANIZATIONS } from "@/data/seed-organizations";
import { getSession } from "@/lib/auth";
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

/** Prototype current user — session when present, else demo staff for tests/SSR edges. */
export function getCurrentUserId(): string {
  if (typeof window === "undefined") return "staff-001";
  return getSession()?.staffId ?? "staff-001";
}

export function getActiveMembership(
  organizationId: string,
  userId: string,
): StaffMembership | undefined {
  return SEED_MEMBERSHIPS.find(
    (m) => m.organizationId === organizationId && m.userId === userId && m.isActive,
  );
}

/** Application-layer membership gate (mock). Not a security boundary. */
export function canAccessOrganization(userId: string, organizationId: string): boolean {
  if (!organizationId) return false;
  if (!SEED_ORGANIZATIONS.some((o) => o.id === organizationId)) return false;
  return Boolean(getActiveMembership(organizationId, userId));
}

export function assertCanAccessOrganization(userId: string, organizationId: string): void {
  if (!canAccessOrganization(userId, organizationId)) {
    throw new OrganizationAccessError();
  }
}

export function listAccessibleOrganizations(userId: string): Organization[] {
  const allowed = new Set(
    SEED_MEMBERSHIPS.filter((m) => m.userId === userId && m.isActive).map(
      (m) => m.organizationId,
    ),
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
