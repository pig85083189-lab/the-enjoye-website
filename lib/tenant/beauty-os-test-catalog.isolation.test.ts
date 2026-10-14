import { afterEach, describe, expect, it } from "vitest";
import {
  SEED_MEMBERSHIPS,
  SEED_ORGANIZATIONS,
  getSeedLocations,
  getSeedOrganization,
} from "@/data/seed-organizations";
import { canAccessOrganization } from "@/lib/tenant/access";
import {
  LOC_BEAUTY_OS_TEST_PRIMARY_ID,
  ORG_BEAUTY_OS_TEST_ID,
  ORG_ENJOYE_ID,
} from "@/lib/tenant/constants";
import { getOrganizationById, persistOrganizationId } from "@/lib/tenant/organization-store";
import {
  hydrateRemoteMemberships,
  listMembershipsForAuthUser,
  resetHydratedRemoteMembershipsForTests,
} from "@/lib/staff-auth/membership-query";
import { resetStaffAuthForTests, setStaffAuthUserForTests } from "@/lib/staff-auth/session";
import type { StaffMembership } from "@/types/saas";

const AUTH_OWNER = "11111111-1111-4111-8111-111111111111";

function testOwnerMembership(): StaffMembership {
  return {
    id: "mem-beauty-os-test-owner",
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    userId: "staff-00t",
    locationIds: [LOC_BEAUTY_OS_TEST_PRIMARY_ID],
    role: "OWNER",
    displayName: "TEST Owner",
    isActive: true,
    createdAt: "2026-10-01T00:00:00+08:00",
    authUserId: AUTH_OWNER,
  };
}

afterEach(() => {
  resetHydratedRemoteMembershipsForTests();
  resetStaffAuthForTests();
  localStorage.clear();
});

describe("Beauty OS TEST catalog for Preview org switcher", () => {
  it("lists TEST in the client catalog without a seed membership", () => {
    expect(SEED_ORGANIZATIONS.some((org) => org.id === ORG_BEAUTY_OS_TEST_ID)).toBe(true);
    expect(getSeedOrganization(ORG_BEAUTY_OS_TEST_ID)?.name).toBe("Beauty OS TEST");
    expect(getOrganizationById(ORG_BEAUTY_OS_TEST_ID)?.id).toBe(ORG_BEAUTY_OS_TEST_ID);
    expect(getSeedLocations(ORG_BEAUTY_OS_TEST_ID).map((row) => row.id)).toEqual([
      LOC_BEAUTY_OS_TEST_PRIMARY_ID,
    ]);
    expect(SEED_MEMBERSHIPS.some((row) => row.organizationId === ORG_BEAUTY_OS_TEST_ID)).toBe(
      false,
    );
    expect(canAccessOrganization("staff-001", ORG_BEAUTY_OS_TEST_ID)).toBe(false);
    expect(persistOrganizationId(ORG_BEAUTY_OS_TEST_ID, "staff-001")).toBe(false);
    expect(localStorage.getItem("beauty-os:current-organization-id")).not.toBe(
      ORG_BEAUTY_OS_TEST_ID,
    );
  });

  it("lets a hydrated Preview Owner membership switch to TEST without hardcoded access", () => {
    hydrateRemoteMemberships([
      {
        id: "mem-enjoye-owner",
        organizationId: ORG_ENJOYE_ID,
        userId: "staff-001",
        locationIds: [],
        role: "OWNER",
        displayName: "Owner",
        isActive: true,
        createdAt: "2025-01-01T00:00:00+08:00",
        authUserId: AUTH_OWNER,
      },
      testOwnerMembership(),
    ]);
    setStaffAuthUserForTests({ id: AUTH_OWNER, email: "owner@example.com" });
    const orgs = listMembershipsForAuthUser(AUTH_OWNER)
      .map((row) => getOrganizationById(row.organizationId))
      .filter((org): org is NonNullable<typeof org> => Boolean(org))
      .map((org) => org.id);
    expect(orgs).toContain(ORG_ENJOYE_ID);
    expect(orgs).toContain(ORG_BEAUTY_OS_TEST_ID);
    expect(canAccessOrganization("staff-00t", ORG_BEAUTY_OS_TEST_ID)).toBe(true);
    expect(persistOrganizationId(ORG_BEAUTY_OS_TEST_ID, "staff-00t")).toBe(true);
    expect(localStorage.getItem("beauty-os:current-organization-id")).toBe(
      ORG_BEAUTY_OS_TEST_ID,
    );
  });
});
