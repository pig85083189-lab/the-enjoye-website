import { beforeEach, describe, expect, it } from "vitest";
import { hydrateRemoteMemberships, resetHydratedRemoteMembershipsForTests } from "@/lib/staff-auth/membership-query";
import {
  canAccessLocation,
  canAccessOrganization,
  listAccessibleOrganizations,
} from "@/lib/tenant/access";
import { directoryFromRemoteRows } from "@/lib/tenant/load-remote-tenant-directory";
import { listLocations, persistOrganizationId } from "@/lib/tenant/organization-store";
import {
  replaceRemoteTenantDirectory,
  resetRemoteTenantDirectoryForTests,
} from "@/lib/tenant/remote-tenant-directory";
import type { StaffMembership } from "@/types/saas";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const TEST_ORG = "org-beauty-os-test";
const TEST_LOC = "loc-beauty-os-test-main";
const FOREIGN_ORG = "org-foreign";

function membership(organizationId: string): StaffMembership {
  return {
    id: organizationId === TEST_ORG ? "mem-beauty-os-test-owner" : "mem-foreign",
    organizationId,
    userId: "staff-001",
    authUserId: AUTH_UUID,
    locationIds: organizationId === TEST_ORG ? [TEST_LOC] : ["loc-foreign"],
    role: "OWNER",
    displayName: "測試帳號",
    isActive: true,
    createdAt: "2026-11-03T00:00:00.000Z",
  };
}

describe("remote tenant directory", () => {
  beforeEach(() => {
    localStorage.clear();
    resetHydratedRemoteMembershipsForTests();
    resetRemoteTenantDirectoryForTests();
  });

  it("keeps organizations the session cannot join out of the directory", () => {
    const directory = directoryFromRemoteRows({
      authUserId: AUTH_UUID,
      memberships: [
        { organization_id: TEST_ORG, is_active: true, auth_user_id: AUTH_UUID },
      ],
      organizations: [
        { id: "77a65221-46ab-4156-bda9-72736a527c7f", app_id: TEST_ORG, name: "Beauty OS TEST", timezone: "Asia/Taipei" },
        { id: "11111111-1111-4111-8111-111111111111", app_id: FOREIGN_ORG, name: "其他店", timezone: "Asia/Taipei" },
      ],
      locations: [
        {
          app_id: TEST_LOC,
          organization_id: "77a65221-46ab-4156-bda9-72736a527c7f",
          name: "Beauty OS TEST 主店",
          timezone: "Asia/Taipei",
          is_primary: true,
          is_active: true,
        },
        {
          app_id: "loc-foreign",
          organization_id: "11111111-1111-4111-8111-111111111111",
          name: "其他分店",
          timezone: "Asia/Taipei",
          is_primary: true,
          is_active: true,
        },
      ],
    });
    expect(directory.organizations.map((organization) => organization.id)).toEqual([TEST_ORG]);
    expect(directory.locations.map((location) => location.id)).toEqual([TEST_LOC]);
  });

  it("lets an authorized manager select Beauty OS TEST and blocks the other organization", () => {
    const directory = directoryFromRemoteRows({
      authUserId: AUTH_UUID,
      memberships: [
        { organization_id: TEST_ORG, is_active: true, auth_user_id: AUTH_UUID },
        { organization_id: FOREIGN_ORG, is_active: true, auth_user_id: "someone-else" },
      ],
      organizations: [
        { id: "77a65221-46ab-4156-bda9-72736a527c7f", app_id: TEST_ORG, name: "Beauty OS TEST", timezone: "Asia/Taipei" },
      ],
      locations: [
        {
          app_id: TEST_LOC,
          organization_id: "77a65221-46ab-4156-bda9-72736a527c7f",
          name: "Beauty OS TEST 主店",
          timezone: "Asia/Taipei",
          is_primary: true,
          is_active: true,
        },
      ],
    });
    replaceRemoteTenantDirectory(directory.organizations, directory.locations);
    hydrateRemoteMemberships([membership(TEST_ORG)]);

    expect(canAccessOrganization("staff-001", TEST_ORG)).toBe(true);
    expect(canAccessOrganization("staff-001", FOREIGN_ORG)).toBe(false);
    expect(canAccessLocation(TEST_ORG, TEST_LOC)).toBe(true);
    expect(canAccessLocation(TEST_ORG, "loc-enjoye-main")).toBe(false);
    expect(listLocations(TEST_ORG).map((location) => location.name)).toEqual(["Beauty OS TEST 主店"]);
    expect(listAccessibleOrganizations("staff-001").some((organization) => organization.name === "Beauty OS TEST")).toBe(
      true,
    );
    expect(persistOrganizationId(TEST_ORG, "staff-001")).toBe(true);
    expect(persistOrganizationId(FOREIGN_ORG, "staff-001")).toBe(false);
    expect(localStorage.getItem("beauty-os:current-organization-id")).toBe(TEST_ORG);
  });
});
