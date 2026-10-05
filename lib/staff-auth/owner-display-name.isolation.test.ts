import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_STAFF } from "@/data/mock-staff";
import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { FUTURE_QA_APPOINTMENT } from "@/lib/appointments/remote-readiness";
import {
  hydrateRemoteMemberships,
  listMemberships,
  resetHydratedRemoteMembershipsForTests,
} from "@/lib/staff-auth/membership-query";
import {
  applyRosterStaffDisplayNames,
  resolveRosterStaffDisplayName,
} from "@/lib/staff-auth/roster-display-name";
import {
  MEMBERSHIP_ENJOYE_OWNER_ID,
  MEMBERSHIP_LUMIERE_STAFF_ID,
  MEMBERSHIP_OVERRIDES_STORAGE_KEY,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import type { StaffMembership } from "@/types/saas";

const AUTH_A = "11111111-1111-4111-8111-111111111111";

function ownerMembership(over: Partial<StaffMembership> = {}): StaffMembership {
  return {
    id: MEMBERSHIP_ENJOYE_OWNER_ID,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-001",
    locationIds: ["loc-enjoye-main"],
    role: "OWNER",
    displayName: "測試帳號",
    isActive: true,
    createdAt: "2025-01-01T00:00:00+08:00",
    authUserId: AUTH_A,
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetHydratedRemoteMembershipsForTests();
});

afterEach(() => {
  resetHydratedRemoteMembershipsForTests();
  localStorage.clear();
});

describe("Phase 1C-6D.2B Owner display rename", () => {
  it("renames only the Enjoye Owner fixture, not Lumiere", () => {
    expect(
      SEED_MEMBERSHIPS.find((row) => row.id === MEMBERSHIP_ENJOYE_OWNER_ID),
    ).toMatchObject({
      userId: "staff-001",
      role: "OWNER",
      displayName: "測試帳號",
    });
    expect(
      SEED_MEMBERSHIPS.find((row) => row.id === MEMBERSHIP_LUMIERE_STAFF_ID),
    ).toMatchObject({
      organizationId: ORG_LUMIERE_ID,
      userId: "staff-001",
      displayName: "怡蓁",
    });
    expect(DEMO_STAFF).toMatchObject({
      id: "staff-001",
      username: "yizhen",
      displayName: "測試帳號",
      name: "測試帳號",
    });
    expect(FUTURE_QA_APPOINTMENT).toMatchObject({
      staffAppId: "staff-001",
      staffName: "測試帳號",
    });
  });

  it("lets the remote canonical display name win over stale overlay 怡蓁", () => {
    hydrateRemoteMemberships([ownerMembership({ displayName: "測試帳號" })]);
    localStorage.setItem(
      MEMBERSHIP_OVERRIDES_STORAGE_KEY,
      JSON.stringify({
        [MEMBERSHIP_ENJOYE_OWNER_ID]: ownerMembership({ displayName: "怡蓁" }),
      }),
    );
    const row = listMemberships(ORG_ENJOYE_ID).find(
      (item) => item.id === MEMBERSHIP_ENJOYE_OWNER_ID,
    );
    expect(row?.displayName).toBe("測試帳號");
    expect(row?.userId).toBe("staff-001");
    expect(row?.role).toBe("OWNER");
  });

  it("ignores seed demo staff and localStorage extras once remote roster is hydrated", () => {
    localStorage.setItem(
      MEMBERSHIP_OVERRIDES_STORAGE_KEY,
      JSON.stringify({
        "mem-local-test-employee": {
          id: "mem-local-test-employee",
          organizationId: ORG_ENJOYE_ID,
          userId: "staff-local-test",
          locationIds: ["loc-enjoye-main"],
          role: "STAFF",
          displayName: "測試員工",
          isActive: true,
          createdAt: "2026-09-01T00:00:00+08:00",
        },
      }),
    );
    hydrateRemoteMemberships([ownerMembership()]);
    const rows = listMemberships(ORG_ENJOYE_ID);
    expect(rows.map((row) => row.displayName)).toEqual(["測試帳號"]);
    expect(rows.map((row) => row.userId)).toEqual(["staff-001"]);
    expect(rows.some((row) => ["小美", "Amy", "安安", "怡蓁", "測試員工"].includes(row.displayName))).toBe(
      false,
    );
  });

  it("keeps the local seed roster when remote memberships are not hydrated", () => {
    const names = listMemberships(ORG_ENJOYE_ID).map((row) => row.displayName);
    expect(names).toEqual(["測試帳號", "小美", "Amy", "安安"]);
  });

  it("overlays roster display onto historical staff-001 appointments without changing staffId", () => {
    const appointments = applyRosterStaffDisplayNames(
      [
        {
          id: "apt-muqrindw-yt0l5z",
          staffId: "staff-001",
          staffName: "怡蓁",
        },
      ],
      [{ userId: "staff-001", displayName: "測試帳號" }],
    );
    expect(appointments[0]?.staffId).toBe("staff-001");
    expect(appointments[0]?.staffName).toBe("測試帳號");
    expect(
      resolveRosterStaffDisplayName("staff-001", "怡蓁", [
        { userId: "staff-001", displayName: "測試帳號" },
      ]),
    ).toBe("測試帳號");
  });

  it("does not let Owner bootstrap overwrite an existing Preview display name", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/staff-auth/server.ts"),
      "utf8",
    );
    const fn = source.slice(source.indexOf("async function ensureOwnerBootstrapRow"));
    const ownerExists = fn.slice(fn.indexOf("if (owner)"), fn.indexOf("const seeded"));
    expect(ownerExists).toMatch(/bindStaffAuthMembershipAuthUser/);
    expect(ownerExists).toMatch(/return;/);
    expect(ownerExists).not.toMatch(/upsertStaffAuthMembership/);
    expect(ownerExists).not.toMatch(/displayName|display_name/);
  });
});
