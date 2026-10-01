import { execSync } from "node:child_process";
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
import { createAppointment, listAppointments } from "@/lib/appointments/store";
import { listBookableStaff, listWorkingHours } from "@/lib/staff-schedule/store";
import {
  createMemoryStaffAuthMembershipStore,
  StaffAuthMembershipConflictError,
} from "@/lib/staff-auth/membership-store";
import {
  assertNoPasswordField,
  staffMembershipToRow,
} from "@/lib/staff-auth/membership-schema";
import { assertOperationalStaffId, isAuthUuid } from "@/lib/staff-auth/staff-id";
import {
  getCurrentUserId,
  resolveOperationalUserId,
} from "@/lib/staff-auth/identity";
import {
  operationalUserIdFromResolution,
  resolveAuthenticatedStaffMembership,
} from "@/lib/staff-auth/resolve-membership";
import {
  resetStaffAuthForTests,
  setStaffAuthUserForTests,
} from "@/lib/staff-auth/session";
import {
  hydrateRemoteMemberships,
  resetHydratedRemoteMembershipsForTests,
} from "@/lib/staff-auth/membership-query";
import { MemoryOperationalDb } from "@/lib/persistence/memory-operational-db";
import { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import {
  FOUNDATION_MIGRATION_FILE,
  IDENTITY_MIGRATION_FILE,
  OPERATIONAL_MIGRATION_FILE,
} from "@/lib/persistence/schema-contract";
import { mapperFor, ORG_A, seedTwoOrgs, STAFF_A } from "@/lib/persistence/test-identity-fixture";
import type { StaffMembership } from "@/types/saas";

const AUTH_A = "11111111-1111-4111-8111-111111111111";
const AUTH_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function gitDiffStat(paths: string): string {
  return execSync(`git diff --stat HEAD -- ${paths}`, { encoding: "utf8" });
}

function ownerMembership(over: Partial<StaffMembership> = {}): StaffMembership {
  return {
    id: MEMBERSHIP_ENJOYE_OWNER_ID,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-001",
    locationIds: [LOC_ENJOYE_PRIMARY_ID],
    role: "OWNER",
    displayName: "怡蓁",
    isActive: true,
    createdAt: "2025-01-01T00:00:00+08:00",
    authUserId: AUTH_A,
    email: "owner@example.com",
    ...over,
  };
}

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

describe("Strategy B staff identity A–Q", () => {
  it("A auth UUID and operational staff ID are different identities", () => {
    expect(isAuthUuid(AUTH_A)).toBe(true);
    expect(isAuthUuid("staff-001")).toBe(false);
    expect(() => assertOperationalStaffId(AUTH_A)).toThrow(/auth UUID/);
    assertOperationalStaffId("staff-001");
    const store = createMemoryStaffAuthMembershipStore([ownerMembership()]);
    expect(store.listByAuthUserId(AUTH_A)[0]?.userId).toBe("staff-001");
    expect(store.listByAuthUserId(AUTH_A)[0]?.authUserId).toBe(AUTH_A);
    expect(store.listByAuthUserId(AUTH_A)[0]?.userId).not.toBe(AUTH_A);
  });

  it("B staff-001 is not rewritten to a UUID", () => {
    const db = new MemoryOperationalDb();
    const { staffA } = seedTwoOrgs(db);
    expect(staffA.staffAppId).toBe("staff-001");
    expect(isAuthUuid(staffA.staffAppId)).toBe(false);
    expect(staffA.profileDbId).not.toBe("staff-001");
    const mapper = new CanonicalIdMapper(db);
    expect(mapper.requireOperationalStaffId(ORG_A, "staff-001")).toBe("staff-001");
    expect(() => mapper.requireOperationalStaffId(ORG_A, AUTH_UUID)).toThrow(
      UnmappedIdentityError,
    );
  });

  it("C Appointment.staffId still accepts and stores staff-*", () => {
    const created = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
      staffId: "staff-001",
      startAt: new Date(2026, 8, 21, 10, 0).toISOString(),
      endAt: new Date(2026, 8, 21, 11, 0).toISOString(),
      createdBy: "staff-001",
      allowConflict: true,
    });
    expect(created.staffId).toBe("staff-001");
    expect(isAuthUuid(created.staffId)).toBe(false);
    const listed = listAppointments({
      organizationId: ORG_ENJOYE_ID,
      staffId: "staff-001",
    });
    expect(listed.some((item) => item.id === created.id && item.staffId === "staff-001")).toBe(
      true,
    );
    const storeSrc = read("lib/appointments/store.ts");
    expect(storeSrc).toMatch(/staffId: input\.staffId/);
    expect(storeSrc).not.toMatch(/authUserId/);
  });

  it("D Treatment operational staff reference is unchanged", () => {
    const source = read("lib/treatments/treatment-workspace-derived.ts");
    expect(source).toMatch(/staffId/);
    expect(source).not.toMatch(/authUserId/);
    expect(read("lib/treatment-draft.ts")).not.toMatch(/authUserId/);
  });

  it("E Schedule / Calendar operational staff reference is unchanged", () => {
    const hours = listWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
    });
    expect(hours.every((item) => item.staffId === "staff-001")).toBe(true);
    const roster = listBookableStaff(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID);
    expect(roster.some((item) => item.userId === "staff-001")).toBe(true);
    expect(read("lib/staff-schedule/store.ts")).not.toMatch(/authUserId/);
  });

  it("F Checkout / Transaction staff reference is unchanged", () => {
    const checkout = read("lib/commerce/checkout-store.ts");
    const settle = read("lib/commerce/settle-effects.ts");
    expect(checkout).toMatch(/item\.userId === staffId/);
    expect(checkout).toMatch(/createdByStaffId/);
    expect(settle).toMatch(/createdByStaffId: staffId/);
    expect(checkout).not.toMatch(/authUserId/);
    expect(settle).not.toMatch(/authUserId/);
  });

  it("G Auth UUID → membership → staff-* mapping is correct", () => {
    const store = createMemoryStaffAuthMembershipStore([ownerMembership()]);
    const rows = store.listByAuthUserId(AUTH_A);
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      memberships: rows,
      organizationId: ORG_ENJOYE_ID,
    });
    expect(resolved.status).toBe("ok");
    expect(resolved.membership?.userId).toBe("staff-001");
    expect(operationalUserIdFromResolution(resolved)).toBe("staff-001");
    hydrateRemoteMemberships([ownerMembership()]);
    expect(
      resolveOperationalUserId({
        authUserId: AUTH_A,
        organizationId: ORG_ENJOYE_ID,
      }),
    ).toBe("staff-001");
    setStaffAuthUserForTests({ id: AUTH_A, email: "owner@example.com" });
    expect(getCurrentUserId()).toBe("staff-001");
  });

  it("H inactive membership is denied for that organization", () => {
    const store = createMemoryStaffAuthMembershipStore([
      ownerMembership({ isActive: false }),
    ]);
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      memberships: store.listByAuthUserId(AUTH_A),
      organizationId: ORG_ENJOYE_ID,
    });
    expect(resolved.status).toBe("inactive");
    expect(operationalUserIdFromResolution(resolved)).toBe("");
    hydrateRemoteMemberships([ownerMembership({ isActive: false })]);
    expect(
      resolveOperationalUserId({
        authUserId: AUTH_A,
        organizationId: ORG_ENJOYE_ID,
        activeOnly: true,
      }),
    ).toBe("");
  });

  it("I the same Auth UUID can hold different memberships across organizations", () => {
    const store = createMemoryStaffAuthMembershipStore([
      ownerMembership(),
      {
        id: MEMBERSHIP_LUMIERE_STAFF_ID,
        organizationId: ORG_LUMIERE_ID,
        userId: "staff-lumiere-01",
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
    expect(rows.find((row) => row.organizationId === ORG_ENJOYE_ID)?.userId).toBe("staff-001");
    expect(rows.find((row) => row.organizationId === ORG_LUMIERE_ID)?.userId).toBe(
      "staff-lumiere-01",
    );
  });

  it("J different organizations cannot cross-read staff mapping", () => {
    const db = new MemoryOperationalDb();
    seedTwoOrgs(db);
    const map = mapperFor(db);
    expect(() => map.requireOperationalStaffId("org-b", STAFF_A)).toThrow(UnmappedIdentityError);
    const store = createMemoryStaffAuthMembershipStore([ownerMembership()]);
    const resolved = resolveAuthenticatedStaffMembership({
      authUserId: AUTH_A,
      memberships: store.listByAuthUserId(AUTH_A),
      organizationId: ORG_LUMIERE_ID,
    });
    expect(resolved.status).toBe("wrong_org");
  });

  it("K role is not client-elevated via authenticated SQL writes", () => {
    const identity = read(IDENTITY_MIGRATION_FILE);
    const operational = read(OPERATIONAL_MIGRATION_FILE);
    expect(identity).not.toMatch(/for insert[\s\S]{0,80}staff_auth_memberships/);
    expect(identity).not.toMatch(/create policy[\s\S]{0,80}insert[\s\S]{0,80}staff_auth_memberships/);
    expect(operational).not.toMatch(
      /create policy staff_auth_memberships_insert/,
    );
    expect(operational).not.toMatch(
      /create policy staff_auth_memberships_update/,
    );
    expect(operational).not.toMatch(
      /grant insert, update, delete on public\.staff_auth_memberships/,
    );
  });

  it("L password never enters application tables", () => {
    const row = staffMembershipToRow(ownerMembership());
    expect(Object.keys(row).some((key) => key.toLowerCase().includes("password"))).toBe(false);
    expect(() => assertNoPasswordField({ password: "secret" })).toThrow(/password/);
    const identity = read(IDENTITY_MIGRATION_FILE);
    const tableBody = identity.slice(
      identity.indexOf("create table if not exists public.staff_auth_memberships"),
      identity.indexOf("comment on table public.staff_auth_memberships"),
    );
    expect(tableBody).not.toMatch(/password/i);
    expect(read(OPERATIONAL_MIGRATION_FILE)).not.toMatch(/^\s+password\b/im);
  });

  it("M does not create a second or third membership store", () => {
    const identity = read(IDENTITY_MIGRATION_FILE);
    const operational = read(OPERATIONAL_MIGRATION_FILE);
    expect(identity).toMatch(/create table if not exists public\.staff_auth_memberships/);
    expect(operational).not.toMatch(/create table if not exists public\.staff_memberships/);
    expect(identity).not.toMatch(/create table if not exists public\.staff_memberships/);
    expect(existsSync(path.join(process.cwd(), "supabase/migrations/20260929120000_staff_auth_memberships.sql"))).toBe(
      false,
    );
    expect(() =>
      createMemoryStaffAuthMembershipStore([
        ownerMembership(),
        ownerMembership({ id: "mem-dup", userId: "staff-001" }),
      ]),
    ).toThrow(StaffAuthMembershipConflictError);
  });

  it("N Phase 5A no longer requires operational staffId = profiles.id UUID", () => {
    const operational = read(OPERATIONAL_MIGRATION_FILE);
    expect(operational).toMatch(/alter column staff_id type text/);
    expect(operational).toContain("created_by_staff_id text not null");
    expect(operational).not.toMatch(/created_by_staff_id uuid not null references public\.profiles/);
    expect(operational).toContain("user_has_org_membership");
    expect(operational).toMatch(/m\.auth_user_id = auth\.uid\(\)/);
    expect(operational).not.toMatch(/m\.user_id = auth\.uid\(\)/);
    const db = new MemoryOperationalDb();
    seedTwoOrgs(db);
    const mapper = mapperFor(db);
    expect(mapper.requireOperationalStaffId(ORG_A, STAFF_A)).toBe("staff-001");
    expect(isAuthUuid(mapper.requireOperationalStaffId(ORG_A, STAFF_A))).toBe(false);
    expect(() => mapper.requireOperationalStaffId(ORG_A, AUTH_UUID)).toThrow(
      UnmappedIdentityError,
    );
  });

  it("O drops Strategy A audit_logs actor_id policy before uuid→text conversion", () => {
    const operational = read(OPERATIONAL_MIGRATION_FILE);
    const dropAt = operational.indexOf(
      "drop policy if exists audit_logs_insert_org on public.audit_logs",
    );
    const alterAt = operational.indexOf("alter column actor_id type text");
    expect(dropAt).toBeGreaterThan(-1);
    expect(alterAt).toBeGreaterThan(-1);
    expect(dropAt).toBeLessThan(alterAt);
    const rebuiltPolicy = operational.slice(
      operational.lastIndexOf("create policy audit_logs_insert_org"),
    );
    expect(rebuiltPolicy).not.toMatch(/actor_id = auth\.uid\(\)/);
    expect(rebuiltPolicy).toMatch(/m\.user_id = actor_id/);
    expect(rebuiltPolicy).toMatch(/m\.auth_user_id = auth\.uid\(\)/);
  });

  it("O RLS SQL source is Strategy B", () => {
    const operational = read(OPERATIONAL_MIGRATION_FILE);
    const identity = read(IDENTITY_MIGRATION_FILE);
    const foundation = read(FOUNDATION_MIGRATION_FILE);
    expect(foundation).toMatch(/staff_id uuid references public\.profiles/);
    expect(operational).toMatch(/from public\.staff_auth_memberships m/);
    expect(operational).toMatch(/join public\.organizations o on o\.app_id = m\.organization_id/);
    expect(operational).toMatch(/m\.is_active = true/);
    expect(identity).toMatch(/auth_user_id = auth\.uid\(\)/);
    expect(operational).not.toMatch(
      /from public\.profiles p[\s\S]{0,80}p\.id = auth\.uid\(\)[\s\S]{0,80}user_has_org_membership/,
    );
    expect(operational).toContain(
      "-- Limitation: JWT has no request-scoped current organization.",
    );
  });

  it("P Core Ops lifecycle files are unchanged", () => {
    expect(gitDiffStat("lib/core-ops")).toBe("");
    expect(gitDiffStat("lib/appointments lib/treatments lib/treatment-draft.ts")).toBe("");
  });

  it("Q Products / Inventory lifecycle files are unchanged", () => {
    expect(gitDiffStat("lib/products lib/inventory")).toBe("");
  });
});
