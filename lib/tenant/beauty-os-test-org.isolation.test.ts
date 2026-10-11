import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_BEAUTY_OS_TEST_PRIMARY_ID,
  LOC_ENJOYE_PRIMARY_ID,
  MEMBERSHIP_BEAUTY_OS_TEST_OWNER_ID,
  ORG_BEAUTY_OS_TEST_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  canAccessLocation,
  canAccessOrganization,
  listAccessibleOrganizations,
} from "@/lib/tenant/access";
import { getMembership, listMemberships } from "@/lib/staff-auth/membership-query";
import {
  getOrganizationById,
  listLocations,
  persistCurrentLocation,
  persistOrganizationId,
} from "@/lib/tenant/organization-store";
import {
  isLineBroadcastSendOpen,
  isLineTestPushOpen,
  LINE_BROADCAST_SEND_OPEN,
  LINE_TEST_PUSH_OPEN,
} from "@/lib/line/line-flag";

describe("Beauty OS TEST organization seed", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds a dedicated test store without renaming THE ENJOYE or LUMIÈRE", () => {
    expect(getOrganizationById(ORG_BEAUTY_OS_TEST_ID)?.name).toBe("Beauty OS TEST");
    expect(getOrganizationById(ORG_ENJOYE_ID)?.name).toBe("THE ENJOYE");
    expect(getOrganizationById(ORG_LUMIERE_ID)?.name).toBe("LUMIÈRE BEAUTY");
  });

  it("lets staff-001 switch into the test store as active OWNER", () => {
    const membership = getMembership(ORG_BEAUTY_OS_TEST_ID, "staff-001");
    expect(membership?.id).toBe(MEMBERSHIP_BEAUTY_OS_TEST_OWNER_ID);
    expect(membership?.role).toBe("OWNER");
    expect(membership?.isActive).toBe(true);
    expect(membership?.userId).toBe("staff-001");
    expect(membership?.authUserId).toBeFalsy();
    expect(canAccessOrganization("staff-001", ORG_BEAUTY_OS_TEST_ID)).toBe(true);
    expect(persistOrganizationId(ORG_BEAUTY_OS_TEST_ID, "staff-001")).toBe(true);
    expect(
      listAccessibleOrganizations("staff-001").some((org) => org.id === ORG_BEAUTY_OS_TEST_ID),
    ).toBe(true);
  });

  it("keeps locations and other users isolated", () => {
    const locations = listLocations(ORG_BEAUTY_OS_TEST_ID);
    expect(locations).toHaveLength(1);
    expect(locations[0]?.id).toBe(LOC_BEAUTY_OS_TEST_PRIMARY_ID);
    expect(canAccessLocation(ORG_BEAUTY_OS_TEST_ID, LOC_ENJOYE_PRIMARY_ID)).toBe(false);
    expect(canAccessLocation(ORG_ENJOYE_ID, LOC_BEAUTY_OS_TEST_PRIMARY_ID)).toBe(false);
    expect(persistCurrentLocation(ORG_BEAUTY_OS_TEST_ID, LOC_ENJOYE_PRIMARY_ID)).toBe(false);
    expect(canAccessOrganization("nobody", ORG_BEAUTY_OS_TEST_ID)).toBe(false);
    expect(persistOrganizationId(ORG_BEAUTY_OS_TEST_ID, "nobody")).toBe(false);
    expect(
      listMemberships(ORG_ENJOYE_ID).some((row) => row.id === MEMBERSHIP_BEAUTY_OS_TEST_OWNER_ID),
    ).toBe(false);
  });

  it("does not open LINE send switches", () => {
    expect(LINE_TEST_PUSH_OPEN).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(isLineTestPushOpen({ organizationId: ORG_BEAUTY_OS_TEST_ID })).toBe(false);
    expect(isLineBroadcastSendOpen()).toBe(false);
  });
});
