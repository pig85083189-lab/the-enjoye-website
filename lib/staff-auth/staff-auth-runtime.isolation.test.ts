import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_KEY, validateCredentials } from "@/lib/auth";
import {
  MEMBERSHIP_ENJOYE_OWNER_ID,
  MEMBERSHIP_ENJOYE_STAFF_XIAOMEI_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { createAppointment } from "@/lib/appointments/store";
import { LOC_ENJOYE_PRIMARY_ID } from "@/lib/tenant/constants";
import {
  getCurrentUserId,
  resolveOperationalUserId,
} from "@/lib/staff-auth/identity";
import {
  applyRemoteMembershipsToClient,
  listMembershipsForAuthUser,
} from "@/lib/staff-auth/membership-query";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import {
  operationalUserIdFromResolution,
  resolveAuthenticatedStaffMembership,
} from "@/lib/staff-auth/resolve-membership";
import { DEFAULT_STAFF_NEXT_PATH, safeStaffNextPath } from "@/lib/staff-auth/redirect";
import { signOutStaff } from "@/lib/staff-auth/sign-out";
import {
  resetStaffAuthForTests,
  setStaffAuthUserForTests,
} from "@/lib/staff-auth/session";
import { updateMembership } from "@/lib/tenant/organization-store";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";
import type { StaffMembership } from "@/types/saas";

const AUTH_OWNER = "11111111-1111-4111-8111-111111111111";
const AUTH_EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const AUTH_NONE = "33333333-3333-4333-8333-333333333333";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function ownerMembership(): StaffMembership {
  return {
    id: MEMBERSHIP_ENJOYE_OWNER_ID,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-001",
    locationIds: [LOC_ENJOYE_PRIMARY_ID],
    role: "OWNER",
    displayName: "怡蓁",
    isActive: true,
    createdAt: "2025-01-01T00:00:00+08:00",
    authUserId: AUTH_OWNER,
    email: "owner@example.com",
  };
}

beforeEach(() => {
  localStorage.clear();
  resetStaffAuthForTests();
});

afterEach(() => {
  resetStaffAuthForTests();
  localStorage.clear();
});

describe("A–H identity / credentials", () => {
  it("A valid Auth + active membership resolves staff-001", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_OWNER,
      memberships: [ownerMembership()],
    });
    expect(resolved.status).toBe("ok");
    expect(resolved.membership?.userId).toBe("staff-001");
    expect(operationalUserIdFromResolution(resolved)).toBe("staff-001");
  });

  it("B production login source no longer accepts yizhen credentials", () => {
    expect(validateCredentials("yizhen", "123456")).toBeNull();
    expect(source("features/auth/LoginForm.tsx")).toMatch(/signInWithPassword/);
    expect(source("features/auth/LoginForm.tsx")).not.toMatch(/yizhen|DEMO_STAFF|記住我/);
    expect(source("lib/auth.ts")).toMatch(/never accepts DEMO_STAFF/);
    expect(source("lib/auth.ts")).toMatch(/return null;/);
  });

  it("C no membership does not invent staff-001", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_NONE,
      memberships: [ownerMembership()],
    });
    expect(resolved.status).toBe("no_membership");
    expect(operationalUserIdFromResolution(resolved)).toBe("");
    setStaffAuthUserForTests({ id: AUTH_NONE, email: "nobody@example.com" });
    expect(getCurrentUserId()).toBe("");
  });

  it("D inactive membership is denied", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_OWNER,
      organizationId: ORG_ENJOYE_ID,
      memberships: [{ ...ownerMembership(), isActive: false }],
    });
    expect(resolved.status).toBe("inactive");
    expect(operationalUserIdFromResolution(resolved)).toBe("");
  });

  it("E wrong organization is denied", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_OWNER,
      organizationId: ORG_LUMIERE_ID,
      memberships: [ownerMembership()],
    });
    expect(resolved.status).toBe("wrong_org");
  });

  it("F multi-org keeps the same operational staff id", () => {
    updateMembership(ORG_ENJOYE_ID, MEMBERSHIP_ENJOYE_OWNER_ID, {
      authUserId: AUTH_OWNER,
    });
    applyRemoteMembershipsToClient([
      ownerMembership(),
      {
        ...ownerMembership(),
        id: "mem-lumiere-staff",
        organizationId: ORG_LUMIERE_ID,
        role: "STAFF",
      },
    ]);
    expect(
      listMembershipsForAuthUser(AUTH_OWNER).map((item) => item.organizationId).sort(),
    ).toEqual([ORG_ENJOYE_ID, ORG_LUMIERE_ID].sort());
    expect(
      resolveOperationalUserId({
        authUserId: AUTH_OWNER,
        organizationId: ORG_ENJOYE_ID,
      }),
    ).toBe("staff-001");
    expect(
      resolveOperationalUserId({
        authUserId: AUTH_OWNER,
        organizationId: ORG_LUMIERE_ID,
      }),
    ).toBe("staff-001");
  });

  it("G Owner maps to staff-001 without bootstrap env when membership exists", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_OWNER,
      memberships: [ownerMembership()],
    });
    expect(resolved.membership?.id).toBe(MEMBERSHIP_ENJOYE_OWNER_ID);
    expect(resolved.membership?.userId).toBe("staff-001");
    expect(source("lib/staff-auth/resolve-membership.ts")).not.toMatch(
      /ownerBootstrapAuthUserId\(\)/,
    );
  });

  it("H employee maps to staff-*", () => {
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_EMPLOYEE,
      memberships: [
        {
          id: MEMBERSHIP_ENJOYE_STAFF_XIAOMEI_ID,
          organizationId: ORG_ENJOYE_ID,
          userId: "staff-002",
          locationIds: [LOC_ENJOYE_PRIMARY_ID],
          role: "STAFF",
          displayName: "小美",
          isActive: true,
          createdAt: "2025-03-01T00:00:00+08:00",
          authUserId: AUTH_EMPLOYEE,
        },
      ],
    });
    expect(resolved.status).toBe("ok");
    expect(resolved.membership?.userId).toBe("staff-002");
    expect(resolved.membership?.userId).not.toBe(AUTH_EMPLOYEE);
  });
});

describe("I–M logout / routes / unconfigured", () => {
  it("I logout signs out Auth and does not wipe operational keys", async () => {
    localStorage.setItem("beauty-os:appointments", "keep");
    localStorage.setItem(AUTH_KEY, JSON.stringify({ staffId: "staff-001" }));
    setStaffAuthUserForTests({ id: AUTH_OWNER, email: "owner@example.com" });
    await signOutStaff();
    expect(getCurrentUserId()).toBe("");
    expect(localStorage.getItem("beauty-os:appointments")).toBe("keep");
    expect(source("lib/staff-auth/sign-out.ts")).toMatch(/auth\.signOut/);
    expect(source("lib/staff-auth/sign-out.ts")).not.toMatch(
      /appointment|customer|treatment|package|transaction/i,
    );
  });

  it("J unauthenticated next is sanitized and proxy redirects /staff/*", () => {
    expect(safeStaffNextPath(null)).toBe(DEFAULT_STAFF_NEXT_PATH);
    expect(safeStaffNextPath("/staff/calendar")).toBe("/staff/calendar");
    expect(safeStaffNextPath("https://evil.example/staff/today")).toBe(
      DEFAULT_STAFF_NEXT_PATH,
    );
    expect(safeStaffNextPath("//evil.example")).toBe(DEFAULT_STAFF_NEXT_PATH);
    expect(safeStaffNextPath("/staff/login?next=/staff/today")).toBe(
      DEFAULT_STAFF_NEXT_PATH,
    );
    expect(safeStaffNextPath("/staff/auth/forgot-password")).toBe(
      DEFAULT_STAFF_NEXT_PATH,
    );
    expect(
      safeStaffNextPath("/staff/auth/setup-password", { allowAuthRoutes: true }),
    ).toBe("/staff/auth/setup-password");
    const proxy = source("lib/supabase/proxy.ts");
    expect(proxy).toMatch(/auth\.getUser/);
    expect(proxy).not.toMatch(/getSession\(\)/);
    expect(proxy).toMatch(/\/staff\/login/);
    expect(proxy).toMatch(/\/staff\/auth/);
  });

  it("K callback exchanges a code and uses the shared next helper", () => {
    const callback = source("app/staff/auth/callback/route.ts");
    expect(callback).toMatch(/exchangeCodeForSession/);
    expect(callback).toMatch(/safeStaffNextPath/);
    expect(callback).toMatch(/allowAuthRoutes:\s*true/);
    expect(callback).not.toMatch(/localStorage/);
    expect(callback).not.toMatch(/localStorage\.setItem/);
    expect(callback).not.toMatch(/updateUser\(\{\s*password/);
  });

  it("L forgot and setup-password routes stay public and do not persist password", () => {
    expect(existsSync(path.join(ROOT, "app/staff/auth/forgot-password/page.tsx"))).toBe(
      true,
    );
    expect(existsSync(path.join(ROOT, "app/staff/auth/setup-password/page.tsx"))).toBe(
      true,
    );
    expect(existsSync(path.join(ROOT, "app/staff/auth/access-unavailable/page.tsx"))).toBe(
      true,
    );
    const forgot = source("app/staff/auth/forgot-password/page.tsx");
    const setup = source("app/staff/auth/setup-password/page.tsx");
    expect(forgot).toMatch(/resetPasswordForEmail/);
    expect(setup).toMatch(/updateUser\(\{\s*password/);
    expect(forgot).not.toMatch(/localStorage/);
    expect(setup).toMatch(/不會寫進 Beauty OS 資料表/);
    expect(source("lib/supabase/proxy.ts")).toMatch(/\/staff\/auth/);
  });

  it("M missing Supabase env does not crash and does not demo-login", () => {
    expect(tryGetSupabaseEnv()).toBeNull();
    expect(source("features/auth/LoginForm.tsx")).toMatch(/目前無法登入/);
    expect(source("features/auth/LoginForm.tsx")).toMatch(/tryGetSupabaseEnv/);
    expect(source("lib/supabase/proxy.ts")).toMatch(/tryGetSupabaseEnv/);
    expect(validateCredentials("yizhen", "123456")).toBeNull();
  });
});

describe("N–S guards / persistence / snapshot", () => {
  it("N no demo fallback remains in Auth runtime", () => {
    const files = [
      "features/auth/LoginForm.tsx",
      "lib/staff-auth/StaffAuthProvider.tsx",
      "lib/staff-auth/server.ts",
      "proxy.ts",
    ];
    for (const file of files) {
      const text = source(file);
      expect(text).not.toMatch(/DEMO_STAFF|yizhen|記住我/);
      expect(text).not.toMatch(/isLocalQaBypassEnabled|BEAUTY_OS_LOCAL_QA_BYPASS|skipRemoteHydration/);
    }
    expect(validateCredentials("yizhen", "123456")).toBeNull();
    expect(source("lib/auth.ts")).toMatch(/return null;/);
  });

  it("O organization snapshot parser stays consistent with Staff Auth snapshot", () => {
    const snapshot = source("lib/tenant/organization-snapshot.ts");
    expect(snapshot).toMatch(/encodeStaffAuthSnapshot/);
    expect(snapshot).toMatch(/parseOrganizationId/);
    expect(source("lib/staff-auth/session.ts")).toMatch(/encodeStaffAuthSnapshot/);
    expect(source("lib/tenant/organization-store.ts")).toMatch(
      /encodeOrganizationSnapshot/,
    );
  });

  it("P organization switching is membership-gated in the store", () => {
    expect(source("lib/tenant/organization-store.ts")).toMatch(
      /canAccessOrganization\(userId, organizationId\)/,
    );
    expect(source("lib/tenant/OrganizationContext.tsx")).toMatch(
      /authMemberships\.find\(\(row\) => row\.organizationId === id\)/,
    );
    expect(source("lib/tenant/access.ts")).toMatch(/JWT current-org/);
  });

  it("Q Auth UUID is never written as Appointment.staffId", () => {
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
    expect(isAuthUuid(created.staffId)).toBe(false);
    expect(created.staffId).not.toBe(AUTH_OWNER);
  });

  it("R password is not persisted by Auth runtime", () => {
    const dump = [
      source("lib/staff-auth/membership-schema.ts"),
      source("lib/staff-auth/session.ts"),
      source("lib/staff-auth/sign-out.ts"),
      source("features/auth/LoginForm.tsx"),
    ].join("\n");
    expect(dump).not.toMatch(/localStorage\.setItem\([^\)]*password/);
    expect(source("lib/staff-auth/membership-schema.ts")).toMatch(
      /assertNoPasswordField/,
    );
  });

  it("S production source has no QA Auth bypass", () => {
    const files = [
      "lib/supabase/proxy.ts",
      "app/staff/(app)/layout.tsx",
      "lib/staff-auth/StaffAuthProvider.tsx",
      "features/auth/LoginForm.tsx",
    ];
    for (const file of files) {
      const text = source(file);
      expect(text).not.toMatch(
        /isLocalQaBypassEnabled|BEAUTY_OS_LOCAL_QA_BYPASS|skipRemoteHydration|LocalQaOrgBootstrap/,
      );
    }
    const authFiles = [
      "lib/staff-auth/server.ts",
      "lib/staff-auth/actions.ts",
      "lib/staff-auth/StaffAuthProvider.tsx",
    ];
    for (const file of authFiles) {
      expect(source(file)).not.toMatch(/BEAUTY_OS_PERSISTENCE=supabase/);
      expect(source(file)).not.toMatch(/lib\/persistence/);
    }
  });
});
