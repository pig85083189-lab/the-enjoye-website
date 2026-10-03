import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UnmappedIdentityError } from "./identity-errors";
import { AppointmentRemoteAdapter } from "./appointment-remote-adapter";
import { createMemoryRemotePersistence } from "./remote-factory";
import { assertMappedAppointmentDependencies } from "./appointment-mapping";
import {
  taipeiLocalToUtcIso,
  utcIsoToTaipeiLocal,
  APPOINTMENT_DISPLAY_TIMEZONE,
} from "./appointment-time";
import { getPersistenceDriver } from "./driver";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-pilot";
import {
  APPOINTMENT_INTEGRITY_MIGRATION_FILE,
  OPERATIONAL_MIGRATION_FILE,
} from "./schema-contract";
import type { CreateAppointmentInput } from "@/lib/appointments/store";
import type { AppointmentTableStore } from "./operational-rows";
import {
  CUST_SHARED,
  LOC_A1,
  LOC_B1,
  ORG_A,
  ORG_B,
  STAFF_A,
  SVC_SHARED,
  mapperFor,
  seedTwoOrgs,
} from "./test-identity-fixture";

const START = "2026-10-09T02:00:00.000Z";
const END = "2026-10-09T03:40:00.000Z";

function input(overrides: Partial<CreateAppointmentInput> = {}): CreateAppointmentInput {
  return {
    locationId: LOC_A1,
    customerId: CUST_SHARED,
    serviceId: SVC_SHARED,
    staffId: STAFF_A,
    startAt: START,
    endAt: END,
    createdBy: STAFF_A,
    ...overrides,
  };
}

function spyStore(
  db: ReturnType<typeof createMemoryRemotePersistence>["db"],
  insert: ReturnType<typeof vi.fn>,
): AppointmentTableStore {
  return {
    insertAppointment: (row) => {
      insert(row);
      db.insertAppointment(row);
    },
    listAppointments: (org) => db.listAppointments(org),
    getAppointmentByAppId: (org, appId) => db.getAppointmentByAppId(org, appId),
    getAppointmentByDbId: (id) => db.getAppointmentByDbId(id),
    updateAppointment: (input) => db.updateAppointment(input),
  };
}

describe("Phase 1C-5A.1 appointment tenant integrity", () => {
  const integrity = readFileSync(
    path.join(process.cwd(), APPOINTMENT_INTEGRITY_MIGRATION_FILE),
    "utf8",
  );
  const operational = readFileSync(
    path.join(process.cwd(), OPERATIONAL_MIGRATION_FILE),
    "utf8",
  );

  it("accepts same-org customer / service / location mapping", () => {
    const db = createMemoryRemotePersistence().db;
    seedTwoOrgs(db);
    const mapper = mapperFor(db);
    const resolved = assertMappedAppointmentDependencies(mapper, ORG_A, input());
    expect(resolved.customerDbId).toBe(mapper.resolveCustomerDbId(ORG_A, CUST_SHARED));
    expect(resolved.serviceDbId).toBe(mapper.resolveServiceDbId(ORG_A, SVC_SHARED));
    expect(resolved.locationDbId).toBe(mapper.resolveLocationDbId(ORG_A, LOC_A1));
    expect(resolved.organizationDbId).toBe(mapper.resolveOrganizationDbId(ORG_A));
  });

  it("rejects a customer that does not belong to the appointment org", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const insert = vi.fn();
    const adapter = new AppointmentRemoteAdapter(remote.mapper, spyStore(db, insert));
    const orgBCustomerDbId = remote.mapper.resolveCustomerDbId(ORG_B, CUST_SHARED);
    expect(remote.mapper.resolveCustomerDbId(ORG_A, CUST_SHARED)).not.toBe(orgBCustomerDbId);
    await expect(adapter.create(ORG_A, input({ customerId: "cust-other-org" }))).rejects.toBeInstanceOf(
      UnmappedIdentityError,
    );
    expect(insert).not.toHaveBeenCalled();
    expect(integrity).toContain("appointments_customer_same_org_fkey");
  });

  it("rejects a service that does not belong to the appointment org", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const insert = vi.fn();
    const adapter = new AppointmentRemoteAdapter(remote.mapper, spyStore(db, insert));
    expect(remote.mapper.resolveServiceDbId(ORG_A, SVC_SHARED)).not.toBe(
      remote.mapper.resolveServiceDbId(ORG_B, SVC_SHARED),
    );
    await expect(adapter.create(ORG_A, input({ serviceId: "svc-other-org" }))).rejects.toBeInstanceOf(
      UnmappedIdentityError,
    );
    expect(insert).not.toHaveBeenCalled();
    expect(integrity).toContain("appointments_service_same_org_fkey");
  });

  it("rejects a location that does not belong to the appointment org", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const insert = vi.fn();
    const adapter = new AppointmentRemoteAdapter(remote.mapper, spyStore(db, insert));
    await expect(adapter.create(ORG_A, input({ locationId: LOC_B1 }))).rejects.toBeInstanceOf(
      UnmappedIdentityError,
    );
    expect(insert).not.toHaveBeenCalled();
    expect(integrity).toContain("appointments_location_same_org_fkey");
  });

  it("rejects a null Appointment location at the database contract", () => {
    expect(integrity).toMatch(/alter column location_id set not null/);
    expect(integrity).toMatch(
      /create policy appointments_insert_org[\s\S]*appointments\.location_id is not null/,
    );
    expect(integrity).toMatch(
      /create policy appointments_update_org[\s\S]*with check[\s\S]*appointments\.location_id is not null/,
    );
  });

  it("still requires authenticated location access, separate from same-org FK", () => {
    expect(integrity).toMatch(
      /create policy appointments_insert_org[\s\S]*user_can_access_location\(\s*appointments\.organization_id,\s*appointments\.location_id/,
    );
    expect(integrity).toMatch(
      /create policy appointments_update_org[\s\S]*using \([\s\S]*user_can_access_location/,
    );
    expect(integrity).not.toMatch(/create or replace function public\.user_can_access_location/);
    expect(operational).toMatch(/target_loc is null/);
  });

  it("UPDATE WITH CHECK cannot retarget customer / service / location / org across tenants", () => {
    expect(integrity).toContain("appointments_customer_same_org_fkey");
    expect(integrity).toContain("appointments_service_same_org_fkey");
    expect(integrity).toContain("appointments_location_same_org_fkey");
    expect(integrity).toMatch(
      /create trigger trg_appointments_staff_integrity\s+before insert or update/,
    );
    const updateBlock = integrity.slice(integrity.lastIndexOf("create policy appointments_update_org"));
    expect(updateBlock).toMatch(/with check \(/);
    expect(updateBlock).toMatch(/user_has_org_membership\(appointments\.organization_id\)/);
    expect(updateBlock).toMatch(/user_can_access_location/);
  });

  it("Auth UUID still cannot be operational staff_id", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    const { staffA } = seedTwoOrgs(db);
    const insert = vi.fn();
    const adapter = new AppointmentRemoteAdapter(remote.mapper, spyStore(db, insert));
    await adapter.create(ORG_A, input({ staffId: STAFF_A, createdBy: STAFF_A }));
    await expect(
      adapter.create(ORG_A, input({ staffId: staffA.authUserId!, createdBy: staffA.authUserId! })),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(operational).toMatch(/is_operational_staff_id\(staff_id\)/);
  });

  it("keeps Taipei time mapping unchanged", () => {
    expect(APPOINTMENT_DISPLAY_TIMEZONE).toBe("Asia/Taipei");
    expect(taipeiLocalToUtcIso("2026-10-09", "10:00")).toBe("2026-10-09T02:00:00.000Z");
    expect(utcIsoToTaipeiLocal("2026-10-09T02:00:00.000Z")).toEqual({
      dateYmd: "2026-10-09",
      hm: "10:00",
    });
  });

  it("keeps canonical app id ↔ UUID mapping unchanged", () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    expect(remote.mapper.resolveOrganizationDbId(ORG_A)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(remote.mapper.toOrganizationAppId(remote.mapper.resolveOrganizationDbId(ORG_A))).toBe(
      ORG_A,
    );
    expect(remote.mapper.resolveCustomerDbId(ORG_A, CUST_SHARED)).not.toBe(
      remote.mapper.resolveCustomerDbId(ORG_B, CUST_SHARED),
    );
    expect(remote.mapper.requireOperationalStaffId(ORG_A, STAFF_A)).toBe(STAFF_A);
  });

  it("does not enable global persistence flags or change the Customer pilot", () => {
    expect(getPersistenceDriver({})).toBe("local");
    expect(getPersistenceDriver({ BEAUTY_OS_PERSISTENCE: "supabase" })).toBe("local");
    expect(
      isCustomerRemoteReadPilotEnabled({
        BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT: "1",
      }),
    ).toBe(true);
  });
});
