import { describe, expect, it } from "vitest";
import { UnmappedIdentityError } from "./identity-errors";
import { MemoryOperationalDb } from "./memory-operational-db";
import {
  CUST_SHARED,
  LOC_A1,
  ORG_A,
  ORG_B,
  STAFF_A,
  mapperFor,
  seedTwoOrgs,
} from "./test-identity-fixture";

describe("Phase 5A-2 canonical ID mapper", () => {
  it("maps org/location/customer/service app_id to uuid and never treats staff app_id as profile uuid", () => {
    const db = new MemoryOperationalDb();
    const { orgA, customerA, staffA } = seedTwoOrgs(db);
    const mapper = mapperFor(db);

    expect(mapper.resolveOrganizationDbId(ORG_A)).toBe(orgA.dbId);
    expect(mapper.toOrganizationAppId(orgA.dbId)).toBe(ORG_A);
    expect(mapper.resolveCustomerDbId(ORG_A, CUST_SHARED)).toBe(customerA.dbId);
    expect(mapper.resolveLocationDbId(ORG_A, LOC_A1)).toMatch(
      /^[0-9a-f-]{36}$/i,
    );

    const profileDbId = mapper.resolveStaffProfileDbId(ORG_A, STAFF_A);
    expect(profileDbId).toBe(staffA.profileDbId);
    expect(profileDbId).not.toBe(STAFF_A);
    expect(mapper.requireOperationalStaffId(ORG_A, STAFF_A)).toBe(STAFF_A);
    expect(mapper.toOperationalStaffId(ORG_A, STAFF_A)).toBe(STAFF_A);
    expect(mapper.resolveStaffMembershipDbId(ORG_A, STAFF_A)).toBe(staffA.membershipDbId);
    expect(mapper.toStaffAppId(ORG_A, profileDbId)).toBe(STAFF_A);
    expect(() => mapper.requireOperationalStaffId(ORG_A, profileDbId)).toThrow(
      UnmappedIdentityError,
    );
  });

  it("isolates the same customer app_id across organizations", () => {
    const db = new MemoryOperationalDb();
    const { customerA, customerB } = seedTwoOrgs(db);
    const mapper = mapperFor(db);
    expect(customerA.appId).toBe(customerB.appId);
    expect(mapper.resolveCustomerDbId(ORG_A, CUST_SHARED)).not.toBe(
      mapper.resolveCustomerDbId(ORG_B, CUST_SHARED),
    );
  });

  it("fails closed on unknown app_id and does not fall back to the other org", () => {
    const db = new MemoryOperationalDb();
    seedTwoOrgs(db);
    const mapper = mapperFor(db);
    expect(() => mapper.resolveOrganizationDbId("org-missing")).toThrow(UnmappedIdentityError);
    expect(() => mapper.resolveCustomerDbId(ORG_A, "cust-missing")).toThrow(UnmappedIdentityError);
    expect(() => mapper.resolveServiceDbId(ORG_A, "svc-missing")).toThrow(UnmappedIdentityError);
    expect(() => mapper.resolveStaffProfileDbId(ORG_A, "staff-missing")).toThrow(
      UnmappedIdentityError,
    );
    expect(() => mapper.resolveLocationDbId(ORG_B, LOC_A1)).toThrow(UnmappedIdentityError);
  });

  it("session cache is not a second SoT — clearing cache still reads uuid+app_id from catalog", () => {
    const db = new MemoryOperationalDb();
    const { orgA } = seedTwoOrgs(db);
    const mapper = mapperFor(db);
    const first = mapper.resolveOrganizationDbId(ORG_A);
    mapper.clearCache();
    expect(mapper.resolveOrganizationDbId(ORG_A)).toBe(first);
    expect(first).toBe(orgA.dbId);
  });
});
