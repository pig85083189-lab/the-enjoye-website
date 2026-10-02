import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_STAFF_OVERLAP_MESSAGE,
  createAppointmentRecord,
  findStaffTimeOverlap,
} from "./appointment-queries";
import { buildFutureFirstAppointmentDomainInput, FUTURE_QA_APPOINTMENT } from "./remote-readiness";
import { createMemoryRemotePersistence } from "@/lib/persistence/remote-factory";
import { seedTwoOrgs, ORG_A, LOC_A1, CUST_SHARED, SVC_SHARED, STAFF_A } from "@/lib/persistence/test-identity-fixture";
import { isGeneratedAppointmentAppId } from "@/lib/persistence/demo-firewall";
import { SnapshotIdentityCatalog } from "@/lib/persistence/snapshot-identity-catalog";
import { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import { assertMappedAppointmentDependencies } from "@/lib/persistence/appointment-mapping";

describe("Phase 1C-5A appointment application boundary", () => {
  it("creates a generated apt-* id through the remote adapter without upsert", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await createAppointmentRecord(
      ORG_A,
      {
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        startAt: "2026-10-09T02:00:00.000Z",
        endAt: "2026-10-09T03:40:00.000Z",
        createdBy: STAFF_A,
      },
      remote,
    );
    expect(isGeneratedAppointmentAppId(created.id)).toBe(true);
    expect(created.status).toBe("BOOKED");
    expect(db.appointments).toHaveLength(1);
    expect(db.appointments[0]?.app_id).toBe(created.id);
    expect(db.appointments[0]?.app_id).not.toBe(db.appointments[0]?.id);
  });

  it("refuses a second overlapping staff booking instead of upserting", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const input = {
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      startAt: "2026-10-09T02:00:00.000Z",
      endAt: "2026-10-09T03:40:00.000Z",
      createdBy: STAFF_A,
    };
    await createAppointmentRecord(ORG_A, input, remote);
    await expect(createAppointmentRecord(ORG_A, input, remote)).rejects.toThrow(
      APPOINTMENT_STAFF_OVERLAP_MESSAGE,
    );
    expect(db.appointments).toHaveLength(1);
    const overlap = await findStaffTimeOverlap(ORG_A, input, remote);
    expect(overlap?.staffId).toBe(STAFF_A);
  });

  it("maps the future QA identities without inserting", () => {
    const catalog = new SnapshotIdentityCatalog(
      [{ appId: FUTURE_QA_APPOINTMENT.organizationAppId, dbId: FUTURE_QA_APPOINTMENT.organizationDbId }],
      [
        {
          organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
          appId: FUTURE_QA_APPOINTMENT.locationAppId,
          dbId: FUTURE_QA_APPOINTMENT.locationDbId,
        },
      ],
      [
        {
          organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
          appId: FUTURE_QA_APPOINTMENT.customerAppId,
          dbId: FUTURE_QA_APPOINTMENT.customerDbId,
        },
      ],
      [
        {
          organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
          appId: FUTURE_QA_APPOINTMENT.serviceAppId,
          dbId: FUTURE_QA_APPOINTMENT.serviceDbId,
        },
      ],
    );
    const mapper = new CanonicalIdMapper(catalog);
    const input = buildFutureFirstAppointmentDomainInput();
    const resolved = assertMappedAppointmentDependencies(mapper, FUTURE_QA_APPOINTMENT.organizationAppId, input);
    expect(resolved).toEqual({
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      locationDbId: FUTURE_QA_APPOINTMENT.locationDbId,
      customerDbId: FUTURE_QA_APPOINTMENT.customerDbId,
      serviceDbId: FUTURE_QA_APPOINTMENT.serviceDbId,
    });
    expect(input.startAt).toBe("2026-10-09T02:00:00.000Z");
    expect(input.endAt).toBe("2026-10-09T03:40:00.000Z");
    expect(input.status).toBe("BOOKED");
  });
});
