import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FUTURE_QA_APPOINTMENT } from "@/lib/appointments/remote-readiness";
import { filterAppointmentWriteStaff } from "@/lib/appointments/appointment-write-form-catalog";
import {
  hydrateRemoteMemberships,
  listMemberships,
  organizationHasRemoteMemberships,
  resetHydratedRemoteMembershipsForTests,
} from "@/lib/staff-auth/membership-query";
import { createMemoryStaffAuthMembershipStore } from "@/lib/staff-auth/membership-store";
import { listBookableStaff } from "@/lib/staff-schedule/store";
import { canManageStaff } from "@/lib/staff/staff-onboarding-derived";
import {
  resolveStaffManagementAccess,
  staffManagementForbiddenHref,
} from "@/lib/staff/staff-management-access";
import {
  prepareStaffRemoteCreateDraft,
  STAFF_REMOTE_CREATABLE_ROLES,
} from "@/lib/staff/staff-remote-create-command";
import { StaffRemoteCreateError } from "@/lib/staff/staff-remote-create-errors";
import {
  isStaffRemoteCreatePilotEnabled,
  STAFF_REMOTE_CREATE_PILOT_ENV,
} from "@/lib/staff/staff-remote-create-flag";
import { runAuthenticatedStaffRemoteCreate } from "@/lib/staff/staff-remote-create-pilot";
import {
  provisionStaffEmployee,
  type StaffRemoteCreateActor,
  type StaffRemoteProvisionDeps,
} from "@/lib/staff/staff-remote-provision";
import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import {
  LOC_ENJOYE_PRIMARY_ID,
  MEMBERSHIP_ENJOYE_OWNER_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { getVisibleNavigationItems } from "@/lib/navigation/resolve";
import type { StaffMembership } from "@/types/saas";

const AUTH_OWNER = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const AUTH_NEW = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PILOT_ENV = {
  VERCEL_ENV: "preview",
  [STAFF_REMOTE_CREATE_PILOT_ENV]: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

function ownerActor(over: Partial<StaffRemoteCreateActor> = {}): StaffRemoteCreateActor {
  return {
    userId: "staff-001",
    organizationId: ORG_ENJOYE_ID,
    role: "OWNER",
    isActive: true,
    locationIds: [LOC_ENJOYE_PRIMARY_ID],
    ...over,
  };
}

function ownerMembership(): StaffMembership {
  return {
    id: MEMBERSHIP_ENJOYE_OWNER_ID,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-001",
    locationIds: [LOC_ENJOYE_PRIMARY_ID],
    role: "OWNER",
    displayName: "測試帳號",
    isActive: true,
    createdAt: "2025-01-01T00:00:00+08:00",
    authUserId: AUTH_OWNER,
    email: "owner@example.com",
  };
}

function validDraft(over: Record<string, unknown> = {}) {
  return {
    displayName: "新員工",
    email: "newbie@example.com",
    password: "password12",
    role: "STAFF",
    locationIds: [LOC_ENJOYE_PRIMARY_ID],
    isActive: true,
    ...over,
  };
}

function createDeps(options?: {
  failAuth?: boolean;
  failMembership?: boolean;
  failLocation?: boolean;
  failAuthCleanup?: boolean;
  existing?: StaffMembership[];
}): StaffRemoteProvisionDeps & {
  createdAuth: string[];
  deletedAuth: string[];
  persisted: StaffMembership[];
  deletedMemberships: string[];
} {
  const store = createMemoryStaffAuthMembershipStore([
    ownerMembership(),
    ...(options?.existing ?? []),
  ]);
  const createdAuth: string[] = [];
  const deletedAuth: string[] = [];
  const persisted: StaffMembership[] = [];
  const deletedMemberships: string[] = [];
  return {
    createdAuth,
    deletedAuth,
    persisted,
    deletedMemberships,
    async createAuthUser(email, password) {
      expect(password).toBe("password12");
      if (options?.failAuth) {
        throw new StaffRemoteCreateError("auth_failed", "無法建立登入帳號");
      }
      createdAuth.push(email);
      return { id: AUTH_NEW };
    },
    async deleteAuthUser(authUserId) {
      if (options?.failAuthCleanup) throw new Error("cleanup failed");
      deletedAuth.push(authUserId);
    },
    async persistMembership(membership) {
      if (options?.failMembership) {
        throw new Error("membership write failed");
      }
      if (options?.failLocation) {
        store.upsert({ ...membership, locationIds: [] });
        throw new Error("location write failed");
      }
      const saved = store.upsert(membership);
      persisted.push(saved);
      return saved;
    },
    async deleteMembership(membershipId) {
      deletedMemberships.push(membershipId);
      store.delete(membershipId);
    },
    async listOrgMemberships(organizationId) {
      return store.listByOrganizationId(organizationId);
    },
    async listOrgLocationIds(organizationId) {
      return organizationId === ORG_ENJOYE_ID ? [LOC_ENJOYE_PRIMARY_ID] : [];
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  resetHydratedRemoteMembershipsForTests();
});

afterEach(() => {
  localStorage.clear();
  resetHydratedRemoteMembershipsForTests();
});

describe("Phase 1C-6D.2C authorization", () => {
  it("Owner sees Staff navigation and non-Owners do not", () => {
    expect(getVisibleNavigationItems("OWNER").map((item) => item.id)).toContain("staff");
    expect(canManageStaff("OWNER")).toBe(true);
    for (const role of ["MANAGER", "STAFF", "RECEPTIONIST", "ACCOUNTANT"] as const) {
      expect(getVisibleNavigationItems(role).map((item) => item.id)).not.toContain("staff");
      expect(canManageStaff(role)).toBe(false);
    }
  });

  it("direct Staff route access is Owner-only and fail-closed", () => {
    expect(resolveStaffManagementAccess({ authenticated: false })).toBe("login");
    expect(
      resolveStaffManagementAccess({ authenticated: true, role: "STAFF", isActive: true }),
    ).toBe("forbidden");
    expect(
      resolveStaffManagementAccess({ authenticated: true, role: "MANAGER", isActive: true }),
    ).toBe("forbidden");
    expect(
      resolveStaffManagementAccess({ authenticated: true, role: "OWNER", isActive: false }),
    ).toBe("forbidden");
    expect(
      resolveStaffManagementAccess({ authenticated: true, role: "OWNER", isActive: true }),
    ).toBe("ok");
    expect(staffManagementForbiddenHref()).toBe("/staff/today");
    const page = readFileSync(path.join(process.cwd(), "app/staff/(app)/staff/page.tsx"), "utf8");
    expect(page).toMatch(/resolveStaffManagementAccess/);
    expect(page).toMatch(/redirect/);
    expect(page).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("Phase 1C-6D.2C provisioning", () => {
  it("lets a valid Owner provision an employee with separate Auth and operational ids", async () => {
    const deps = createDeps();
    const created = await provisionStaffEmployee(ownerActor(), validDraft(), deps);
    expect(created.userId.startsWith("staff-")).toBe(true);
    expect(created.id.startsWith("mem-")).toBe(true);
    expect(created.authUserId).toBe(AUTH_NEW);
    expect(created.userId).not.toBe(AUTH_NEW);
    expect(created.role).toBe("STAFF");
    expect(created.email).toBe("newbie@example.com");
    expect(created.locationIds).toEqual([LOC_ENJOYE_PRIMARY_ID]);
    expect(JSON.stringify(created)).not.toMatch(/password12/);
    expect(deps.createdAuth).toEqual(["newbie@example.com"]);
    expect(deps.persisted[0]?.authUserId).toBe(AUTH_NEW);
    expect(JSON.stringify(deps.persisted[0])).not.toMatch(/password12/);
    expect(localStorage.getItem("beauty-os:membership-overrides:v1")).toBeNull();
  });

  it("denies unauthenticated, non-Owner, OWNER privilege, invalid role, cross-org location, and duplicate email", async () => {
    const deps = createDeps({
      existing: [
        {
          ...ownerMembership(),
          id: "mem-dup",
          userId: "staff-dup",
          authUserId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
          email: "newbie@example.com",
          role: "STAFF",
        },
      ],
    });
    await expect(
      runAuthenticatedStaffRemoteCreate(validDraft(), deps, PILOT_ENV, async () => ({
        status: "unauthenticated",
        membership: null,
        memberships: [],
      })),
    ).rejects.toMatchObject({ reason: "unauthenticated" });
    await expect(
      provisionStaffEmployee(ownerActor({ role: "MANAGER" }), validDraft(), createDeps()),
    ).rejects.toMatchObject({ reason: "unauthorized" });
    await expect(
      provisionStaffEmployee(ownerActor(), validDraft({ role: "OWNER" }), createDeps()),
    ).rejects.toMatchObject({ reason: "privilege_denied" });
    await expect(
      provisionStaffEmployee(ownerActor(), validDraft({ role: "THERAPIST" }), createDeps()),
    ).rejects.toMatchObject({ reason: "invalid_input" });
    await expect(
      provisionStaffEmployee(
        ownerActor(),
        validDraft({ locationIds: ["loc-lumiere-main"] }),
        createDeps(),
      ),
    ).rejects.toMatchObject({ reason: "invalid_input" });
    await expect(
      provisionStaffEmployee(ownerActor(), validDraft(), deps),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(STAFF_REMOTE_CREATABLE_ROLES).not.toContain("OWNER");
  });
});

describe("Phase 1C-6D.2C failure and rollback", () => {
  it("creates nothing when Auth fails", async () => {
    const deps = createDeps({ failAuth: true });
    await expect(
      provisionStaffEmployee(ownerActor(), validDraft(), deps),
    ).rejects.toMatchObject({ reason: "auth_failed" });
    expect(deps.persisted).toEqual([]);
    expect(deps.createdAuth).toEqual([]);
  });

  it("cleans up the Auth user when membership fails", async () => {
    const deps = createDeps({ failMembership: true });
    await expect(
      provisionStaffEmployee(ownerActor(), validDraft(), deps),
    ).rejects.toMatchObject({ reason: "membership_failed" });
    expect(deps.deletedAuth).toEqual([AUTH_NEW]);
    expect(deps.persisted).toEqual([]);
  });

  it("does not report success when location assignment fails", async () => {
    const deps = createDeps({ failLocation: true });
    await expect(
      provisionStaffEmployee(ownerActor(), validDraft(), deps),
    ).rejects.toMatchObject({ reason: "membership_failed" });
    expect(deps.deletedMemberships.length).toBe(1);
    expect(deps.deletedAuth).toEqual([AUTH_NEW]);
  });

  it("returns partial provisioning when Auth cleanup fails", async () => {
    const deps = createDeps({ failMembership: true, failAuthCleanup: true });
    await expect(
      provisionStaffEmployee(ownerActor(), validDraft(), deps),
    ).rejects.toMatchObject({ reason: "partial_provisioning" });
  });

  it("keeps the pilot disabled when the env is unset and requires explicit 1 plus Supabase keys", () => {
    expect(isStaffRemoteCreatePilotEnabled({ VERCEL_ENV: "production", [STAFF_REMOTE_CREATE_PILOT_ENV]: "1" })).toBe(
      false,
    );
    expect(
      isStaffRemoteCreatePilotEnabled({
        VERCEL_ENV: "production",
        [STAFF_REMOTE_CREATE_PILOT_ENV]: "1",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).toBe(true);
    expect(isStaffRemoteCreatePilotEnabled({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isStaffRemoteCreatePilotEnabled(PILOT_ENV)).toBe(true);
  });
});

describe("Phase 1C-6D.2C readback and regression", () => {
  it("adds the new employee to Staff / Calendar / Create rosters without changing 測試帳號", async () => {
    const deps = createDeps();
    const created = await provisionStaffEmployee(ownerActor(), validDraft(), deps);
    hydrateRemoteMemberships([
      ownerMembership(),
      {
        id: created.id,
        organizationId: created.organizationId,
        userId: created.userId,
        locationIds: created.locationIds,
        role: created.role,
        displayName: created.displayName,
        isActive: created.isActive,
        createdAt: created.createdAt,
        authUserId: created.authUserId,
        email: created.email,
      },
    ]);
    expect(organizationHasRemoteMemberships(ORG_ENJOYE_ID)).toBe(true);
    const staff = listMemberships(ORG_ENJOYE_ID);
    expect(staff.map((row) => row.displayName).sort()).toEqual(["新員工", "測試帳號"]);
    expect(staff.some((row) => ["小美", "Amy", "安安", "測試員工"].includes(row.displayName))).toBe(
      false,
    );
    const calendar = listBookableStaff(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID);
    expect(calendar.map((row) => row.displayName).sort()).toEqual(["新員工", "測試帳號"]);
    expect(
      filterAppointmentWriteStaff(
        staff.map((row) => ({
          id: row.userId,
          name: row.displayName,
          role: row.role,
          locationIds: row.locationIds,
        })),
        LOC_ENJOYE_PRIMARY_ID,
      ).map((row) => row.name).sort(),
    ).toEqual(["新員工", "測試帳號"]);
    expect(
      SEED_MEMBERSHIPS.find((row) => row.id === MEMBERSHIP_ENJOYE_OWNER_ID)?.displayName,
    ).toBe("測試帳號");
    expect(FUTURE_QA_APPOINTMENT.staffAppId).toBe("staff-001");
  });

  it("does not invent username auth or leak service-role / password into client files", () => {
    const login = readFileSync(path.join(process.cwd(), "features/auth/LoginForm.tsx"), "utf8");
    expect(login).toMatch(/signInWithPassword/);
    expect(login).toMatch(/email/);
    const dialog = readFileSync(
      path.join(process.cwd(), "features/staff/StaffOnboardingDialog.tsx"),
      "utf8",
    );
    expect(dialog).toMatch(/登入 Email/);
    expect(dialog).toMatch(/初始密碼/);
    expect(dialog).toMatch(/確認密碼/);
    expect(dialog).toMatch(/provisionStaffEmployeeAction/);
    expect(dialog).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(dialog).toMatch(/busy/);
    const workspace = readFileSync(
      path.join(process.cwd(), "features/staff/StaffWorkspacePage.tsx"),
      "utf8",
    );
    expect(workspace).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    const adapter = readFileSync(
      path.join(process.cwd(), "lib/staff/staff-remote-create-adapter.ts"),
      "utf8",
    );
    expect(adapter).toMatch(/cannot run in the browser/);
    expect(adapter).toMatch(/auth\.admin\.createUser/);
    expect(prepareStaffRemoteCreateDraft(validDraft()).password).toBe("password12");
    expect(ORG_LUMIERE_ID).toBe("org-lumiere");
    const provision = readFileSync(
      path.join(process.cwd(), "lib/staff/staff-remote-provision.ts"),
      "utf8",
    );
    const command = readFileSync(
      path.join(process.cwd(), "lib/staff/staff-remote-create-command.ts"),
      "utf8",
    );
    expect(provision).not.toMatch(/upsertWorkingHours|working hours/);
    expect(command).not.toMatch(/upsertWorkingHours|workingHours/);
  });
});
