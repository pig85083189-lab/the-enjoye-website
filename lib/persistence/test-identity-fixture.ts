import { CanonicalIdMapper } from "./identity-map";
import { MemoryOperationalDb } from "./memory-operational-db";

export const ORG_A = "org-a";
export const ORG_B = "org-b";
export const LOC_A1 = "loc-a-1";
export const LOC_A2 = "loc-a-2";
export const LOC_B1 = "loc-b-1";
export const CUST_SHARED = "cust-shared";
export const SVC_SHARED = "svc-shared";
export const STAFF_A = "staff-001";
export const STAFF_B = "staff-b";

export function seedTwoOrgs(db: MemoryOperationalDb) {
  const orgA = db.seedOrganization(ORG_A, "Org A");
  const orgB = db.seedOrganization(ORG_B, "Org B");
  db.seedLocation(orgA.dbId, LOC_A1, "A1");
  db.seedLocation(orgA.dbId, LOC_A2, "A2");
  db.seedLocation(orgB.dbId, LOC_B1, "B1");
  const customerA = db.seedCustomer(orgA.dbId, CUST_SHARED, "Shared name A");
  const customerB = db.seedCustomer(orgB.dbId, CUST_SHARED, "Shared name B");
  db.seedService(orgA.dbId, SVC_SHARED, "Service A");
  db.seedService(orgB.dbId, SVC_SHARED, "Service B");
  const staffA = db.seedStaff(orgA.dbId, STAFF_A, "STAFF");
  const staffB = db.seedStaff(orgB.dbId, STAFF_B, "STAFF");
  return { orgA, orgB, customerA, customerB, staffA, staffB };
}

export function mapperFor(db: MemoryOperationalDb) {
  return new CanonicalIdMapper(db);
}
