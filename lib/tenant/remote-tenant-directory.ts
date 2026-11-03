/**
 * Organizations and locations visible to the signed-in staff session.
 * Filled only from that session's Supabase reads. Never a second source of
 * authorization: membership checks still decide whether a switch is allowed.
 */

import type { Location, Organization } from "@/types/saas";

let organizations: Organization[] = [];
let locations: Location[] = [];
let revision = 0;

export function getRemoteTenantRevision(): number {
  return revision;
}

export function listRemoteOrganizations(): Organization[] {
  return organizations;
}

export function hasRemoteOrganization(organizationId: string): boolean {
  return organizations.some((organization) => organization.id === organizationId);
}

export function listRemoteLocations(organizationId: string): Location[] {
  return locations.filter(
    (location) => location.organizationId === organizationId && location.isActive,
  );
}

export function replaceRemoteTenantDirectory(
  nextOrganizations: Organization[],
  nextLocations: Location[],
): void {
  organizations = nextOrganizations;
  locations = nextLocations;
  revision += 1;
}

export function resetRemoteTenantDirectoryForTests(): void {
  organizations = [];
  locations = [];
  revision += 1;
}
