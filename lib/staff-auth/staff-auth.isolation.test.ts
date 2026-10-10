import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LOC_ENJOYE_PRIMARY_ID,
  MEMBERSHIP_ENJOYE_OWNER_ID,
  MEMBERSHIP_ENJOYE_STAFF_XIAOMEI_ID,
  MEMBERSHIP_LUMIERE_STAFF_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { AUTH_KEY, validateCredentials } from "@/lib/auth";
import {
  assertOperationalStaffId,
  deriveStaffLoginBinding,
  isAuthUuid,
  listMemberships,
  listMembershipsForAuthUser,
} from "@/lib/staff-auth/membership-query";
import {
  getCurrentUserId,
  operationalStaffIdFromMembership,
  resolveActiveMembershipsForAuthUser,
  resolveOperationalUserId,
} from "@/lib/staff-auth/identity";
import {
  resetStaffAuthForTests,
  setStaffAuthUserForTests,
} from "@/lib/staff-auth/session";
import { canActorManageStaff } from "@/lib/staff-auth/actors";
import { getStaffInviteCapability } from "@/lib/staff-auth/invite-capability";
import { ownerBootstrapProcedure } from "@/lib/staff-auth/bootstrap";
import {
  createMembership,
  listMemberships as listOrgMemberships,
  updateMembership,
} from "@/lib/tenant/organization-store";
import { getActiveMembership } from "@/lib/tenant/access";
import { listBookableStaff, getWorkingHoursForDay } from "@/lib/staff-schedule/store";
import { createAppointment, listAppointments } from "@/lib/appointments/store";
import { canManageStaff } from "@/lib/staff/staff-onboarding-derived";

const AUTH_A = "11111111-1111-4111-8111-111111111111";
const AUTH_B = "22222222-2222-4222-8222-222222222222";
const AUTH_NONE = "33333333-3333-4333-8333-333333333333";

const PHASE_5A_PATHS = [
  "lib/packages/domain.ts",
  "lib/packages/store.ts",
  "types/database.ts",
  "lib/persistence/adapter.ts",
  "supabase/migrations/20260928112900_beauty_os_enum_adapt.sql",
  "supabase/migrations/20260928113000_beauty_os_operational_foundation.sql",
];

beforeEach(() => {
  localStorage.clear();
  resetStaffAuthForTests();
});

afterEach(() => {
  resetStaffAuthForTests();
  localStorage.clear();
});

describe("A–E identity mapping", () => {
  it("A maps auth user to the correct StaffMembership", () => {
    updateMembership(ORG_ENJOYE_ID, MEMBERSHIP_ENJOYE_OWNER_ID, {
      authUserId: AUTH_A,
    });
    const rows = listMembershipsForAuthUser(AUTH_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(MEMBERSHIP_ENJOYE_OWNER_ID);
    expect(rows[0]?.userId).toBe("staff-001");
  });

  it("B membership.userId remains operational staff-xxx", () => {
    updateMembership(ORG_ENJOYE_ID, MEMBERSHIP_ENJOYE_OWNER_ID, {
      authUserId: AUTH_A,
    });
    setStaffAuthUserForTests({ id: AUTH_A, email: "owner@example.com" });
    expect(getCurrentUserId()).toBe("staff-001");
    expect(isAuthUuid(getCurrentUserId())).toBe(false);
  });

  it("C membership.id never becomes staffId", () => {
    const membership = listMemberships(ORG_ENJOYE_ID).find(
      (item) => item.id === MEMBERSHIP_ENJOYE_OWNER_ID,
    )!;
    expect(operationalStaffIdFromMembership(membership)).toBe("staff-001");
    expect(membership.id).not.toBe("staff-001");
    expect(membership.id.startsWith("mem-")).toBe(true);
  });

  it("D auth UUID is never written as Appointment.staffId", () => {
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
    expect(created.staffId).not.toBe(AUTH_A);
    expect(isAuthUuid(created.staffId)).toBe(false);
    expect(() => assertOperationalStaffId(AUTH_A)).toThrow(/auth UUID/);
  });

  it("E one auth user can hold two org memberships", () => {
    updateMembership(ORG_ENJOYE_ID, MEMBERSHIP_ENJOYE_OWNER_ID, {
      authUserId: AUTH_A,
    });
    updateMembership(ORG_LUMIERE_ID, MEMBERSHIP_LUMIERE_STAFF_ID, {
      authUserId: AUTH_A,
    });
    const rows = listMembershipsForAuthUser(AUTH_A);
    expect(rows.map((item) => item.organizationId).sort()).toEqual(
      [ORG_ENJOYE_ID, ORG_LUMIERE_ID].sort(),
    );
    expect(rows.every((item) => item.userId === "staff-001")).toBe(true);
    setStaffAuthUserForTests({ id: AUTH_A, email: "amy@example.com" });
    expect(
      resolveOperationalUserId({
        authUserId: AUTH_A,
        organizationId: ORG_ENJOYE_ID,
      }),
    ).toBe("staff-001");
    expect(
      resolveOperationalUserId({
        authUserId: AUTH_A,
        organizationId: ORG_LUMIERE_ID,
      }),
    ).toBe("staff-001");
  });
});

describe("F–I membership gates", () => {
  it("F inactive membership is denied for that organization", () => {
    updateMembership(ORG_ENJOYE_ID, MEMBERSHIP_ENJOYE_OWNER_ID, {
      authUserId: AUTH_A,
      isActive: false,
    });
    expect(
      resolveActiveMembershipsForAuthUser(AUTH_A).some(
        (item) => item.organizationId === ORG_ENJOYE_ID,
      ),
    ).toBe(false);
    expect(getActiveMembership(ORG_ENJOYE_ID, "staff-001")).toBeUndefined();
    expect(
      listBookableStaff(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID).some(
        (item) => item.userId === "staff-001",
      ),
    ).toBe(false);
  });

  it("G active membership is allowed", () => {
    updateMembership(ORG_ENJOYE_ID, MEMBERSHIP_ENJOYE_OWNER_ID, {
      authUserId: AUTH_A,
      isActive: true,
    });
    expect(getActiveMembership(ORG_ENJOYE_ID, "staff-001")?.userId).toBe("staff-001");
    expect(
      listBookableStaff(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID).some(
        (item) => item.userId === "staff-001",
      ),
    ).toBe(true);
  });

  it("H no membership → access unavailable (empty operational id)", () => {
    setStaffAuthUserForTests({ id: AUTH_NONE, email: "nobody@example.com" });
    expect(resolveActiveMembershipsForAuthUser(AUTH_NONE)).toEqual([]);
    expect(getCurrentUserId()).toBe("");
  });

  it("I never falls back to staff-001 without a mapped session", () => {
    expect(getCurrentUserId()).toBe("");
    setStaffAuthUserForTests({ id: AUTH_B, email: "unmapped@example.com" });
    expect(getCurrentUserId()).toBe("");
  });
});

describe("J–K password / fake localStorage", () => {
  it("J password is never persisted in localStorage", () => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ staffId: "staff-001" }));
    const dump = JSON.stringify(localStorage);
    expect(dump).not.toMatch(/123456/);
    expect(dump).not.toMatch(/password/);
    const membership = JSON.stringify(listOrgMemberships(ORG_ENJOYE_ID));
    expect(membership).not.toMatch(/password/);
  });

  it("K fake enjoye-staff-auth cannot authenticate", () => {
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({
        staffId: "staff-001",
        username: "yizhen",
        name: "怡蓁",
        remember: true,
      }),
    );
    expect(validateCredentials("yizhen", "123456")).toBeNull();
    expect(getCurrentUserId()).toBe("");
  });
});

describe("L–N staff management actor guards", () => {
  it("L OWNER can invite/manage", () => {
    expect(canActorManageStaff(ORG_ENJOYE_ID, "staff-001")).toBe(true);
    expect(canManageStaff("OWNER")).toBe(true);
    const created = createMembership({
      organizationId: ORG_ENJOYE_ID,
      displayName: "邀請對象",
      role: "STAFF",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
      email: "invitee@example.com",
      actorStaffId: "staff-001",
    });
    expect(created.userId.startsWith("staff-")).toBe(true);
    expect(created.authUserId).toBeNull();
  });

  it("M MANAGER cannot invite/manage", () => {
    const manager = createMembership({
      organizationId: ORG_ENJOYE_ID,
      displayName: "店長",
      role: "MANAGER",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
      actorStaffId: "staff-001",
    });
    expect(canActorManageStaff(ORG_ENJOYE_ID, manager.userId)).toBe(false);
    expect(() =>
      createMembership({
        organizationId: ORG_ENJOYE_ID,
        displayName: "店長新增",
        role: "STAFF",
        locationIds: [LOC_ENJOYE_PRIMARY_ID],
        actorStaffId: manager.userId,
      }),
    ).toThrow(/沒有權限/);
  });

  it("N STAFF cannot manage staff", () => {
    expect(canActorManageStaff(ORG_ENJOYE_ID, "staff-002")).toBe(false);
    expect(() =>
      createMembership({
        organizationId: ORG_ENJOYE_ID,
        displayName: "不該成功",
        role: "STAFF",
        locationIds: [LOC_ENJOYE_PRIMARY_ID],
        actorStaffId: "staff-002",
      }),
    ).toThrow(/沒有權限/);
    expect(() =>
      updateMembership(
        ORG_ENJOYE_ID,
        MEMBERSHIP_ENJOYE_STAFF_XIAOMEI_ID,
        { displayName: "hack" },
        "staff-002",
      ),
    ).toThrow(/沒有權限/);
  });
});

describe("O–R mapping keeps operational joins", () => {
  it("O invite mapping keeps existing staff userId", () => {
    const created = createMembership({
      organizationId: ORG_ENJOYE_ID,
      displayName: "綁定對象",
      role: "STAFF",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
      email: "bind@example.com",
      actorStaffId: "staff-001",
    });
    const userId = created.userId;
    const bound = updateMembership(
      ORG_ENJOYE_ID,
      created.id,
      { authUserId: AUTH_B },
      "staff-001",
    );
    expect(bound.userId).toBe(userId);
    expect(bound.authUserId).toBe(AUTH_B);
    expect(deriveStaffLoginBinding(bound)).toBe("bound");
  });

  it("P existing appointments survive auth mapping", () => {
    const appointment = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
      staffId: "staff-001",
      startAt: new Date(2026, 8, 22, 10, 0).toISOString(),
      endAt: new Date(2026, 8, 22, 11, 0).toISOString(),
      allowConflict: true,
    });
    updateMembership(ORG_ENJOYE_ID, MEMBERSHIP_ENJOYE_OWNER_ID, {
      authUserId: AUTH_A,
    });
    const found = listAppointments({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
    }).find((item) => item.id === appointment.id);
    expect(found?.staffId).toBe("staff-001");
  });

  it("Q Calendar roster still joins userId", () => {
    const roster = listBookableStaff(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID);
    expect(roster.some((item) => item.userId === "staff-001")).toBe(true);
    expect(roster.every((item) => item.userId !== item.id)).toBe(true);
    expect(roster.every((item) => !isAuthUuid(item.userId))).toBe(true);
  });

  it("R Schedule still joins userId", () => {
    const hours = getWorkingHoursForDay(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      "staff-001",
      1,
    );
    expect(hours.staffId).toBe("staff-001");
    expect(hours.staffId).not.toBe(MEMBERSHIP_ENJOYE_OWNER_ID);
  });
});

describe("S–T contracts + invite honesty", () => {
  it("S Checkout / Package / Service contracts do not take auth UUID staffId", () => {
    const root = process.cwd();
    const checkout = readFileSync(
      path.join(root, "lib/commerce/checkout-workspace.isolation.test.ts"),
      "utf8",
    );
    const packages = readFileSync(path.join(root, "lib/packages/store.ts"), "utf8");
    const services = readFileSync(path.join(root, "lib/services/store.ts"), "utf8");
    expect(checkout).not.toMatch(/authUserId/);
    expect(packages).not.toMatch(/StaffAuth/);
    expect(services).not.toMatch(/auth.users/);
  });

  it("T Phase 5A dirty files stay outside Auth modules; invite unavailable is honest", () => {
    expect(getStaffInviteCapability({ serviceRoleKey: null }).configured).toBe(
      false,
    );
    expect(getStaffInviteCapability({ serviceRoleKey: null }).message).toMatch(
      /尚未啟用/,
    );
    expect(
      getStaffInviteCapability({
        invitePilotEnabled: true,
        inviteSendOpen: true,
        serviceRoleKey: null,
      }).message,
    ).toMatch(/尚未設定/);
    expect(ownerBootstrapProcedure().some((line) => line.includes("password"))).toBe(
      true,
    );

    const authFiles = [
      "lib/staff-auth/identity.ts",
      "lib/staff-auth/actions.ts",
      "lib/staff-auth/membership-query.ts",
      "lib/supabase/env.ts",
    ];
    for (const file of authFiles) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/lib\/persistence/);
      expect(source).not.toMatch(/20260928112900_beauty_os_enum_adapt/);
      expect(source).not.toMatch(/EmployeeProfile|StaffAccount|AuthStaff/);
    }
    for (const file of PHASE_5A_PATHS) {
      expect(authFiles.includes(file)).toBe(false);
    }
  });
});

describe("no local QA auth bypass in production source", () => {
  it("proxy, staff layout, and StaffAuthProvider do not contain a QA auth gate", () => {
    const root = process.cwd();
    const proxy = readFileSync(path.join(root, "lib/supabase/proxy.ts"), "utf8");
    const layout = readFileSync(
      path.join(root, "app/staff/(app)/layout.tsx"),
      "utf8",
    );
    const provider = readFileSync(
      path.join(root, "lib/staff-auth/StaffAuthProvider.tsx"),
      "utf8",
    );
    expect(proxy).toMatch(/\/staff\/login/);
    expect(proxy).not.toMatch(/isLocalQaBypassEnabled|BEAUTY_OS_LOCAL_QA_BYPASS/);
    expect(layout).not.toMatch(
      /isLocalQaBypassEnabled|LocalQaOrgBootstrap|localQaStaffAuthUser/,
    );
    expect(provider).not.toMatch(/skipRemoteHydration|BEAUTY_OS_LOCAL_QA_BYPASS/);
  });
});

