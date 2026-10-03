import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  MEMBERSHIP_ENJOYE_OWNER_ID,
  MEMBERSHIP_LUMIERE_STAFF_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { validateCredentials } from "@/lib/auth";
import {
  applyRemoteMembershipsToClient,
  hydrateRemoteMemberships,
  listMemberships,
  listMembershipsForAuthUser,
  resetHydratedRemoteMembershipsForTests,
} from "@/lib/staff-auth/membership-query";
import { getCurrentUserId } from "@/lib/staff-auth/identity";
import {
  resetStaffAuthForTests,
  setStaffAuthUserForTests,
} from "@/lib/staff-auth/session";
import {
  createMemoryStaffAuthMembershipStore,
  StaffAuthMembershipConflictError,
} from "@/lib/staff-auth/membership-store";
import {
  operationalUserIdFromResolution,
  resolveAuthenticatedStaffMembership,
} from "@/lib/staff-auth/resolve-membership";
import {
  interpretInviteAndBind,
  extractInvitedAuthUserId,
} from "@/lib/staff-auth/invite-mapping";
import {
  assertNoPasswordField,
  staffMembershipFromRow,
  staffMembershipToRow,
  uniquenessAuthOrg,
} from "@/lib/staff-auth/membership-schema";
import { OWNER_BOOTSTRAP_ENV, OWNER_BOOTSTRAP_SQL } from "@/lib/staff-auth/bootstrap";
import { createAppointment, listAppointments } from "@/lib/appointments/store";
import { listBookableStaff, listWorkingHours } from "@/lib/staff-schedule/store";
import {
  createMembership,
  updateMembership,
} from "@/lib/tenant/organization-store";
import type { StaffMembership } from "@/types/saas";

const AUTH_A = "11111111-1111-4111-8111-111111111111";
const AUTH_B = "22222222-2222-4222-8222-222222222222";
const AUTH_NONE = "33333333-3333-4333-8333-333333333333";

const PHASE_5A_FILES: Record<string, string> = {
  "lib/packages/domain.ts":
    "e47e86586dcf4f116563ea8282df7f7077d9651f298643f1fe3580cf09d64a7f",
  "lib/packages/store.ts":
    "d65cfced0ccd48edc120fc38ca03780360fc68e1e1987721823c4978feb424a8",
  "types/database.ts":
    "e5d02ee909d51e5d52c1234dc95de91272f1022845030bc0ef23e0f91ded6601",
  "supabase/migrations/20260928112900_beauty_os_enum_adapt.sql":
    "ac16bce1a5baa0de2b52f7ade010ae340c1196897ee77c1984ff47b3b792acaf",
};

beforeEach(() => {
  localStorage.clear();
  resetStaffAuthForTests();
  resetHydratedRemoteMembershipsForTests();
});

afterEach(() => {
  resetStaffAuthForTests();
  resetHydratedRemoteMembershipsForTests();
  localStorage.clear();
});

function ownerMembership(over: Partial<StaffMembership> = {}): StaffMembership {
  return {
    id: MEMBERSHIP_ENJOYE_OWNER_ID,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-001",
    locationIds: [LOC_ENJOYE_PRIMARY_ID],
    role: "OWNER",
    displayName: "測試帳號",
    isActive: true,
    createdAt: "2025-01-01T00:00:00+08:00",
    authUserId: AUTH_A,
    email: "owner@example.com",
    ...over,
  };
}

function sha256(file: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(process.cwd(), file)))
    .digest("hex");
}

describe("Staff Auth Phase 2 A–H identity / resolver", () => {
  it("A maps auth UUID to membership via canonical store", () => {
    const store = createMemoryStaffAuthMembershipStore([ownerMembership()]);
    const rows = store.listByAuthUserId(AUTH_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe("staff-001");
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      memberships: rows,
    });
    expect(resolved.status).toBe("ok");
    expect(resolved.membership?.id).toBe(MEMBERSHIP_ENJOYE_OWNER_ID);
  });

  it("B membership.userId remains operational staff-xxx", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      memberships: [ownerMembership()],
    });
    expect(operationalUserIdFromResolution(resolved)).toBe("staff-001");
  });

  it("C does not fall back to staff-001 for an unmatched auth user", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_NONE,
      memberships: [ownerMembership()],
    });
    expect(resolved.status).toBe("no_membership");
    expect(operationalUserIdFromResolution(resolved)).toBe("");
    setStaffAuthUserForTests({ id: AUTH_NONE, email: "nobody@example.com" });
    expect(getCurrentUserId()).toBe("");
  });

  it("D inactive membership is denied for that organization", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      organizationId: ORG_ENJOYE_ID,
      memberships: [ownerMembership({ isActive: false })],
    });
    expect(resolved.status).toBe("inactive");
    expect(operationalUserIdFromResolution(resolved)).toBe("");
  });

  it("E wrong organization is denied", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      organizationId: ORG_LUMIERE_ID,
      memberships: [ownerMembership()],
    });
    expect(resolved.status).toBe("wrong_org");
  });

  it("F one auth user can hold memberships in two organizations", () => {
    const store = createMemoryStaffAuthMembershipStore([
      ownerMembership(),
      {
        id: MEMBERSHIP_LUMIERE_STAFF_ID,
        organizationId: ORG_LUMIERE_ID,
        userId: "staff-001",
        locationIds: [],
        role: "STAFF",
        displayName: "怡蓁",
        isActive: true,
        createdAt: "2026-08-01T00:00:00+08:00",
        authUserId: AUTH_A,
      },
    ]);
    const rows = store.listByAuthUserId(AUTH_A);
    expect(rows).toHaveLength(2);
    const enjoye = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      organizationId: ORG_ENJOYE_ID,
      memberships: rows,
    });
    const lumiere = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      organizationId: ORG_LUMIERE_ID,
      memberships: rows,
    });
    expect(enjoye.membership?.role).toBe("OWNER");
    expect(lumiere.membership?.role).toBe("STAFF");
    expect(enjoye.membership?.userId).toBe("staff-001");
    expect(uniquenessAuthOrg(AUTH_A, ORG_ENJOYE_ID)).not.toBe(
      uniquenessAuthOrg(AUTH_A, ORG_LUMIERE_ID),
    );
  });

  it("G role stays on StaffMembership", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      memberships: [ownerMembership({ role: "MANAGER" })],
    });
    expect(resolved.membership?.role).toBe("MANAGER");
    const source = readFileSync(
      path.join(process.cwd(), "lib/staff-auth/resolve-membership.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/user_metadata\.role/);
  });

  it("H locations come from the membership join list, not a second SoT array column", () => {
    const membership = ownerMembership({
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
    });
    const row = staffMembershipToRow(membership);
    expect(row).not.toHaveProperty("location_ids");
    expect(staffMembershipFromRow(row, membership.locationIds).locationIds).toEqual(
      [LOC_ENJOYE_PRIMARY_ID],
    );
  });
});

describe("Staff Auth Phase 2 I–K invite / bootstrap", () => {
  it("I invite mapping writes auth UUID onto the same operational userId", async () => {
    const created = createMembership({
      organizationId: ORG_ENJOYE_ID,
      displayName: "新進",
      role: "STAFF",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
      email: "new@example.com",
      actorStaffId: "staff-001",
    });
    const userId = created.userId;
    const store = createMemoryStaffAuthMembershipStore([created]);
    store.bindAuthUser(created.id, AUTH_B);
    expect(store.getById(created.id)?.userId).toBe(userId);
    expect(store.getById(created.id)?.authUserId).toBe(AUTH_B);
  });

  it("J invite partial failure keeps membership and does not fake success", async () => {
    const inviteFailed = interpretInviteAndBind({
      configured: true,
      invite: { ok: false, message: "smtp down" },
    });
    expect(inviteFailed.kind).toBe("invite_failed");
    expect(inviteFailed.message).toMatch(/員工已建立，登入邀請失敗/);
    expect(inviteFailed.authUserId).toBeNull();

    const mappingFailed = interpretInviteAndBind({
      configured: true,
      invite: { ok: true, authUserId: AUTH_B },
      bind: { ok: false, message: "write failed" },
    });
    expect(mappingFailed.kind).toBe("mapping_failed");
    expect(mappingFailed.message).toMatch(/登入綁定失敗/);
    expect(extractInvitedAuthUserId({ userId: AUTH_B, identities: [] })).toBe(AUTH_B);
  });

  it("K owner bootstrap maps UUID onto staff-001 without creating another owner id", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      memberships: [],
      ownerBootstrapAuthUserId: AUTH_A,
    });
    expect(resolved.status).toBe("ok");
    expect(resolved.membership?.id).toBe(MEMBERSHIP_ENJOYE_OWNER_ID);
    expect(resolved.membership?.userId).toBe("staff-001");
    expect(OWNER_BOOTSTRAP_ENV).toBe("NEXT_PUBLIC_BEAUTY_OS_OWNER_AUTH_USER_ID");
    const sql = readFileSync(path.join(process.cwd(), OWNER_BOOTSTRAP_SQL), "utf8");
    expect(sql).toMatch(/staff-001/);
    expect(sql).not.toMatch(/@theenjoye/);
    expect(sql.toLowerCase()).not.toMatch(/password\s*=/);
  });
});

describe("Staff Auth Phase 2 L–Q operational identity unchanged", () => {
  it("L appointment staffId stays staff-001", () => {
    updateMembership(ORG_ENJOYE_ID, MEMBERSHIP_ENJOYE_OWNER_ID, {
      authUserId: AUTH_A,
    });
    const created = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
      staffId: "staff-001",
      startAt: new Date(2026, 8, 21, 10, 0).toISOString(),
      endAt: new Date(2026, 8, 21, 11, 0).toISOString(),
      allowConflict: true,
    });
    expect(created.staffId).toBe("staff-001");
    expect(
      listAppointments({
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
      }).find((item) => item.id === created.id)?.staffId,
    ).toBe("staff-001");
  });

  it("M treatment identity still uses staff-xxx in the treatment workspace contract", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/treatments/treatment-workspace-derived.ts"),
      "utf8",
    );
    expect(source).toMatch(/staffId/);
    expect(source).not.toMatch(/authUserId/);
  });

  it("N schedule identity still uses staff-xxx", () => {
    const hours = listWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
    });
    expect(hours.every((item) => item.staffId === "staff-001")).toBe(true);
  });

  it("O calendar roster still joins userId", () => {
    const roster = listBookableStaff(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID);
    expect(roster.some((item) => item.userId === "staff-001")).toBe(true);
  });

  it("P checkout / package / redemption still use operational staff ids", () => {
    const checkout = readFileSync(
      path.join(process.cwd(), "lib/commerce/checkout-store.ts"),
      "utf8",
    );
    const packages = readFileSync(path.join(process.cwd(), "lib/packages/store.ts"), "utf8");
    expect(checkout).toMatch(/item\.userId === staffId/);
    expect(packages).not.toMatch(/staff_auth_memberships/);
    expect(packages).not.toMatch(/authUserId/);
  });

  it("Q password is never persisted on membership rows", () => {
    const row = staffMembershipToRow(ownerMembership());
    expect(Object.keys(row).some((key) => key.toLowerCase().includes("password"))).toBe(
      false,
    );
    expect(() => assertNoPasswordField({ password: "x" })).toThrow(/password/);
    const migration = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20260928112950_staff_auth_memberships.sql"),
      "utf8",
    );
    const tableBody = migration.slice(
      migration.indexOf("create table if not exists public.staff_auth_memberships"),
      migration.indexOf("comment on table public.staff_auth_memberships"),
    );
    expect(tableBody).not.toMatch(/password/i);
    expect(migration).toMatch(/staff_auth_memberships/);
    expect(migration).not.toMatch(/create table if not exists public\.staff_memberships/);
  });
});

describe("Staff Auth Phase 2 R–T contracts", () => {
  it("R has no demo auth credentials", () => {
    expect(validateCredentials("yizhen", "123456")).toBeNull();
    const login = readFileSync(
      path.join(process.cwd(), "features/auth/LoginForm.tsx"),
      "utf8",
    );
    expect(login).not.toMatch(/記住我/);
    expect(login).not.toMatch(/yizhen|DEMO_STAFF/);
    expect(login).toMatch(/登入狀態會安全保留在此裝置/);
  });

  it("S does not add a second Staff / Employee / Membership store", () => {
    const files = [
      "lib/staff-auth/membership-store.ts",
      "lib/staff-auth/membership-schema.ts",
      "lib/staff-auth/resolve-membership.ts",
      "lib/staff-auth/actions.ts",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/EmployeeProfile|StaffProfile|EmployeeStore|AuthStaffStore/);
      expect(source).not.toMatch(/lib\/persistence/);
    }
    expect(() =>
      createMemoryStaffAuthMembershipStore([
        ownerMembership(),
        ownerMembership({ id: "mem-dup", userId: "staff-001" }),
      ]),
    ).toThrow(StaffAuthMembershipConflictError);
  });

  it("T unrelated Phase 5A / Core Ops / Products files stay untouched", () => {
    for (const [file, hash] of Object.entries(PHASE_5A_FILES)) {
      expect(sha256(file)).toBe(hash);
    }
    expect(existsSync(path.join(process.cwd(), "supabase/migrations/20260929120000_staff_auth_memberships.sql"))).toBe(
      false,
    );
  });
});

describe("Staff Auth Phase 2 hydrate + uniqueness", () => {
  it("hydrated remote memberships become readable without replacing operational ids", () => {
    hydrateRemoteMemberships([
      ownerMembership({ displayName: "遠端怡蓁" }),
    ]);
    const rows = listMembershipsForAuthUser(AUTH_A);
    expect(rows[0]?.displayName).toBe("遠端怡蓁");
    expect(rows[0]?.userId).toBe("staff-001");
    applyRemoteMembershipsToClient([ownerMembership({ displayName: "裝置怡蓁" })]);
    expect(listMemberships(ORG_ENJOYE_ID).find((item) => item.id === MEMBERSHIP_ENJOYE_OWNER_ID)?.displayName).toBe(
      "裝置怡蓁",
    );
  });

  it("auth_user_id is unique per organization, not globally", () => {
    const store = createMemoryStaffAuthMembershipStore([ownerMembership()]);
    expect(() =>
      store.upsert({
        ...ownerMembership(),
        id: "mem-other-owner",
        userId: "staff-other",
      }),
    ).toThrow(/auth_user_id, organization_id/);
    const secondOrg = store.upsert({
      id: MEMBERSHIP_LUMIERE_STAFF_ID,
      organizationId: ORG_LUMIERE_ID,
      userId: "staff-001",
      locationIds: [],
      role: "STAFF",
      displayName: "怡蓁",
      isActive: true,
      createdAt: "2026-08-01T00:00:00+08:00",
      authUserId: AUTH_A,
    });
    expect(secondOrg.organizationId).toBe(ORG_LUMIERE_ID);
  });

  it("unauthenticated resolution never invents staff-001", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: null,
      memberships: [ownerMembership()],
    });
    expect(resolved.status).toBe("unauthenticated");
    expect(operationalUserIdFromResolution(resolved)).toBe("");
  });
});
