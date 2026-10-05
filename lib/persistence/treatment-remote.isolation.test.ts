import { describe, expect, it, vi } from "vitest";
import { UnmappedIdentityError } from "./identity-errors";
import { TreatmentRemoteAdapter } from "./treatment-remote-adapter";
import { createMemoryRemotePersistence } from "./remote-factory";
import { remoteTreatmentPayload } from "./treatment-mapping";
import {
  CUST_SHARED,
  LOC_A1,
  LOC_B1,
  ORG_A,
  ORG_B,
  STAFF_A,
  SVC_SHARED,
  seedTwoOrgs,
} from "./test-identity-fixture";
import {
  TreatmentCompletedImmutableError,
  TreatmentDuplicateError,
  TreatmentWriteZeroRowError,
} from "@/lib/treatments/treatment-write-errors";
import { REMOTE_DEMO_TREATMENT_MESSAGE } from "./demo-firewall";
import type { TreatmentDraft } from "@/types/treatment";
import { createEmptyDraft } from "@/lib/treatment-draft";
import type { TreatmentTableStore } from "./operational-rows";

const START = "2026-10-01T02:00:00.000Z";
const END = "2026-10-01T03:00:00.000Z";

async function seedAppointment(
  remote: ReturnType<typeof createMemoryRemotePersistence>["remote"],
  id = "apt-trt01-abcdef",
) {
  return remote.appointments.create(ORG_A, {
    id,
    locationId: LOC_A1,
    customerId: CUST_SHARED,
    serviceId: SVC_SHARED,
    staffId: STAFF_A,
    startAt: START,
    endAt: END,
    createdBy: STAFF_A,
    customerName: "真實客人",
    serviceName: "美胸",
    staffName: "怡蓁",
  });
}

function draftFor(appointmentId: string, treatmentId: string): TreatmentDraft {
  return {
    ...createEmptyDraft({
      organizationId: ORG_A,
      locationId: LOC_A1,
      appointmentId,
      customerId: CUST_SHARED,
      staffId: STAFF_A,
      serviceId: SVC_SHARED,
    }),
    id: treatmentId,
    assessment: {
      concerns: ["外擴"],
      clientFocus: "改善",
      sensitivityLevel: 2,
      comparisonToLast: "",
    },
    professionalNote: "草稿備註",
  };
}

describe("Phase 1C-6G canonical treatment remote adapter", () => {
  it("creates a trt-* draft mapped to canonical customer / appointment / staff", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointment = await seedAppointment(remote);
    const created = await remote.treatments.create(ORG_A, {
      id: "trt-1001-abcdef",
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointment.id,
      createdBy: STAFF_A,
      draft: { professionalNote: "開始療程" },
    });
    expect(created.id).toBe("trt-1001-abcdef");
    expect(created.status).toBe("draft");
    expect(created.customerId).toBe(CUST_SHARED);
    expect(created.appointmentId).toBe(appointment.id);
    expect(created.staffId).toBe(STAFF_A);
    const row = db.getTreatmentByAppId(
      remote.mapper.resolveOrganizationDbId(ORG_A),
      "trt-1001-abcdef",
    );
    expect(row?.status).toBe("DRAFT");
    expect(row?.created_by).toBe(STAFF_A);
    expect(row?.appointment_id).toBe(
      db.getAppointmentByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), appointment.id)?.id,
    );
    expect(remoteTreatmentPayload(row!)).not.toHaveProperty("previewUrl");
  });

  it("rejects local treatment-* ids, seed treatments, and Auth UUID staff", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    const { staffA } = seedTwoOrgs(db);
    const appointment = await seedAppointment(remote);
    await expect(
      remote.treatments.create(ORG_A, {
        id: "treatment-seed-001",
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointment.id,
      }),
    ).rejects.toThrow(REMOTE_DEMO_TREATMENT_MESSAGE);
    await expect(
      remote.treatments.create(ORG_A, {
        id: `treatment-${appointment.id}`,
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointment.id,
      }),
    ).rejects.toThrow(REMOTE_DEMO_TREATMENT_MESSAGE);
    await expect(
      remote.treatments.create(ORG_A, {
        id: "trt-1002-abcdef",
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: staffA.authUserId!,
        appointmentId: appointment.id,
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
  });

  it("refuses unmapped customer / appointment and does not insert", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const insert = vi.fn();
    const spyStore: TreatmentTableStore = {
      insertTreatment: (row) => {
        insert(row);
        return db.insertTreatment(row);
      },
      listTreatments: (org) => db.listTreatments(org),
      listTreatmentsByCustomer: (org, customer) => db.listTreatmentsByCustomer(org, customer),
      getTreatmentByAppId: (org, appId) => db.getTreatmentByAppId(org, appId),
      getTreatmentByDbId: (id) => db.getTreatmentByDbId(id),
      getTreatmentByAppointmentId: (org, apt) => db.getTreatmentByAppointmentId(org, apt),
      updateTreatment: (input) => db.updateTreatment(input),
    };
    const adapter = new TreatmentRemoteAdapter(remote.mapper, spyStore, db);
    await expect(
      adapter.create(ORG_A, {
        id: "trt-1003-abcdef",
        locationId: LOC_A1,
        customerId: "cust-missing",
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    expect(insert).toHaveBeenCalledTimes(0);
    await expect(
      adapter.create(ORG_A, {
        id: "trt-1004-abcdef",
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: "apt-missing-zzzzzz",
      }),
    ).rejects.toThrow(/not in this organization|not found/i);
    expect(insert).toHaveBeenCalledTimes(0);
  });

  it("prevents a second treatment for the same appointment", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointment = await seedAppointment(remote);
    await remote.treatments.create(ORG_A, {
      id: "trt-1005-abcdef",
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointment.id,
    });
    await expect(
      remote.treatments.create(ORG_A, {
        id: "trt-1006-abcdef",
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointment.id,
      }),
    ).rejects.toBeInstanceOf(TreatmentDuplicateError);
  });

  it("hydrates create from the authoritative INSERT updated_at", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointment = await seedAppointment(remote, "apt-trt-auth-abcdef");
    const dbStamp = "2026-10-05T03:00:00.123Z";
    const store: TreatmentTableStore = {
      insertTreatment: (row) => {
        const authoritative = { ...row, updated_at: dbStamp, created_at: dbStamp };
        db.insertTreatment(authoritative);
        return authoritative;
      },
      listTreatments: (org) => db.listTreatments(org),
      listTreatmentsByCustomer: (org, customer) => db.listTreatmentsByCustomer(org, customer),
      getTreatmentByAppId: (org, appId) => db.getTreatmentByAppId(org, appId),
      getTreatmentByDbId: (id) => db.getTreatmentByDbId(id),
      getTreatmentByAppointmentId: (org, apt) => db.getTreatmentByAppointmentId(org, apt),
      updateTreatment: (input) => db.updateTreatment(input),
    };
    const adapter = new TreatmentRemoteAdapter(remote.mapper, store, db, () =>
      new Date("2026-10-05T02:59:00.000Z"),
    );
    const created = await adapter.create(ORG_A, {
      id: "trt-auth01-abcdef",
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointment.id,
      createdBy: STAFF_A,
    });
    expect(created.updatedAt).toBe(dbStamp);
    expect(created.createdAt).toBe(dbStamp);
    const saved = await adapter.update(ORG_A, {
      treatmentId: created.id,
      expectedUpdatedAt: created.updatedAt,
      updatedBy: STAFF_A,
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointment.id,
      draft: draftFor(appointment.id, created.id),
    });
    expect(saved.updatedAt).not.toBe(created.updatedAt);
    await expect(
      adapter.update(ORG_A, {
        treatmentId: created.id,
        expectedUpdatedAt: created.updatedAt,
        updatedBy: STAFF_A,
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointment.id,
        draft: draftFor(appointment.id, created.id),
      }),
    ).rejects.toBeInstanceOf(TreatmentWriteZeroRowError);
  });

  it("autosaves with OCC and refuses stale / completed overwrite", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointment = await seedAppointment(remote);
    const created = await remote.treatments.create(ORG_A, {
      id: "trt-1007-abcdef",
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointment.id,
    });
    const saved = await remote.treatments.update(ORG_A, {
      treatmentId: created.id,
      expectedUpdatedAt: created.updatedAt,
      updatedBy: STAFF_A,
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointment.id,
      draft: draftFor(appointment.id, created.id),
    });
    expect(saved.professionalNote).toBe("草稿備註");
    expect(saved.updatedAt).not.toBe(created.updatedAt);
    await expect(
      remote.treatments.update(ORG_A, {
        treatmentId: created.id,
        expectedUpdatedAt: created.updatedAt,
        updatedBy: STAFF_A,
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointment.id,
        draft: draftFor(appointment.id, created.id),
      }),
    ).rejects.toBeInstanceOf(TreatmentWriteZeroRowError);

    const completed = await remote.treatments.complete(ORG_A, {
      treatmentId: created.id,
      expectedUpdatedAt: saved.updatedAt,
      updatedBy: STAFF_A,
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointment.id,
      draft: draftFor(appointment.id, created.id),
    });
    expect(completed.status).toBe("completed");
    await expect(
      remote.treatments.update(ORG_A, {
        treatmentId: created.id,
        expectedUpdatedAt: completed.updatedAt,
        updatedBy: STAFF_A,
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointment.id,
        draft: draftFor(appointment.id, created.id),
      }),
    ).rejects.toBeInstanceOf(TreatmentCompletedImmutableError);
  });

  it("refuses cross-org customer and appointment mix", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointment = await seedAppointment(remote);
    await expect(
      remote.treatments.create(ORG_B, {
        id: "trt-1008-abcdef",
        locationId: LOC_B1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointment.id,
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    await expect(
      remote.treatments.create(ORG_A, {
        id: "trt-1009-abcdef",
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointment.id,
        draft: { customerId: "cust-other" },
      }),
    ).resolves.toMatchObject({ customerId: CUST_SHARED });
  });

  it("lists customer history from remote rows only", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointment = await seedAppointment(remote);
    await remote.treatments.create(ORG_A, {
      id: "trt-1010-abcdef",
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointment.id,
    });
    const listed = await remote.treatments.listByCustomerId(ORG_A, CUST_SHARED);
    expect(listed.map((item) => item.id)).toEqual(["trt-1010-abcdef"]);
    expect(await remote.treatments.listByCustomerId(ORG_B, CUST_SHARED)).toEqual([]);
  });

  it("does not persist photo bytes or treatment_photos rows", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointment = await seedAppointment(remote);
    const created = await remote.treatments.create(ORG_A, {
      id: "trt-1011-abcdef",
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointment.id,
      draft: {
        photos: [
          {
            id: "photo-1",
            treatmentId: "trt-1011-abcdef",
            type: "BEFORE",
            createdAt: START,
            hadPreview: true,
          },
        ],
      },
    });
    expect(created.photos[0]?.hadPreview).toBe(true);
    const row = db.getTreatmentByAppId(
      remote.mapper.resolveOrganizationDbId(ORG_A),
      created.id,
    );
    expect(JSON.stringify(row?.photo_meta)).not.toMatch(/blob:|data:image|previewUrl/);
    expect(db).not.toHaveProperty("treatment_photos");
  });
});
