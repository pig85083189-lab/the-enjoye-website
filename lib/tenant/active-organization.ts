import { ORG_ENJOYE_ID } from "./constants";

let activeOrganizationId = ORG_ENJOYE_ID;

/** Module-level active tenant for non-React storage helpers (synced by OrganizationProvider). */
export function getActiveOrganizationId(): string {
  return activeOrganizationId;
}

export function setActiveOrganizationId(organizationId: string): void {
  activeOrganizationId = organizationId;
}
