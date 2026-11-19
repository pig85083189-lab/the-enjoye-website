import { describe, expect, it } from "vitest";
import { createMemoryRemotePersistence } from "@/lib/persistence/remote-factory";
import {
  CUST_SHARED,
  LOC_A1,
  ORG_A,
  STAFF_A,
  SVC_SHARED,
  seedTwoOrgs,
} from "@/lib/persistence/test-identity-fixture";
import { createEmptyDraft, normalizeTreatmentDraft } from "@/lib/treatment-draft";
import type { TreatmentDraft } from "@/types/treatment";
import {
  BROWSER_SYNC_CONFLICT_MESSAGE,
  BROWSER_SYNC_IDENTITY_MESSAGE,
  BROWSER_SYNC_PAUSE_MESSAGE,
  decideBrowserCompletedHydration,
  syncBrowserCompletedTreatment,
} from "./sync-browser-completed-treatment";

const START = "2026-11-19T02:00:00.000Z";
const END = "2026-11-19T03:00:00.000Z";

function localCompleted(appointmentId: string): TreatmentDraft {
  const draft = createEmptyDraft({
    organizationId: ORG_A,
    locationId: LOC_A1,
    appointmentId,
    customerId: CUST_SHARED,
    staffId: STAFF_A,
    serviceId: SVC_SHARED,
  });
  return {
    ...draft,
    status: "completed",
    currentStep: "complete",
    furthestStep: "complete",
    assessment: {
      concerns: ["乾燥"],
      clientFocus: "鎖水",
      sensitivityLevel: 2,
      comparisonToLast: "improved",
      consultationAnswers: {
        "suitable-products": ["精華"],
        "focus-areas": ["肩頸"],
        "assessment-note": "今日膚況穩定",
        "next-course": ["美液澎潤upupSPA"],
        "recommendation-reason": "補水",
        "next-care-date": "2026-12-19",
      },
    },
    bodyMarkers: [{ id: "marker-1", area: "肩頸", conditions: ["緊繃"], note: "右側較明顯" }],
    bodyMapNote: "右肩補充說明",
    professionalNote: "本次以保濕為主",
    clientFeeling: "舒服",
    discomfortNote: "",
    followUp: {
      tags: ["補水"],
      suggestedDate: "2026-12-19",
      note: "兩週後回診",
      suggestNextBooking: true,
    },
    suggestedTrackingAreas: ["肩頸"],
    products: ["保濕精華"],
  };
}

async function seedAppointment(
  remote: ReturnType<typeof createMemoryRemotePersistence>["remote"],
) {
  return remote.appointments.create(ORG_A, {
    id: "apt-nov19-abcdef",
    locationId: LOC_A1,
    customerId: CUST_SHARED,
    serviceId: SVC_SHARED,
    staffId: STAFF_A,
    startAt: START,
    endAt: END,
    createdBy: STAFF_A,
    customerName: "LINE會員",
    serviceName: "美液澎潤upupSPA",
    staffName: "測試帳號",
  });
}

describe("browser completed treatment sync", () => {
  it("writes the browser record under the appointment customer and rereads it once", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    const seeded = seedTwoOrgs(db);
    const appointment = await seedAppointment(remote);
    const local = localCompleted(appointment.id);
    expect(local.id.startsWith("treatment-")).toBe(true);

    const readRemote = async () =>
      (await remote.treatments.getByAppointmentId(ORG_A, appointment.id)) ?? null;
    const sync = () =>
      syncBrowserCompletedTreatment({
        identity: {
          organizationId: ORG_A,
          locationId: LOC_A1,
          appointmentId: appointment.id,
          customerId: CUST_SHARED,
          staffId: STAFF_A,
          serviceId: SVC_SHARED,
        },
        local,
        readRemote,
        createRemote: (source) =>
          remote.treatments.create(ORG_A, {
            locationId: source.locationId!,
            customerId: source.customerId,
            serviceId: source.serviceId,
            staffId: source.staffId,
            appointmentId: source.appointmentId,
            createdBy: source.staffId,
            draft: source,
          }),
        completeRemote: (row, source) =>
          remote.treatments.complete(ORG_A, {
            treatmentId: row.id,
            expectedUpdatedAt: row.updatedAt,
            updatedBy: source.staffId,
            locationId: row.locationId!,
            customerId: row.customerId,
            serviceId: row.serviceId,
            staffId: row.staffId,
            appointmentId: row.appointmentId,
            draft: source,
          }),
      });

    const first = await sync();
    const second = await sync();
    expect(first.id).toMatch(/^trt-/);
    expect(second.id).toBe(first.id);
    expect(db.treatments).toHaveLength(1);
    const row = db.treatments[0]!;
    expect(row.organization_id).toBe(seeded.orgA.dbId);
    expect(row.customer_id).toBe(seeded.customerA.dbId);
    expect(row.appointment_id).toBe(db.appointments[0]?.id);
    expect(row.staff_id).toBe(STAFF_A);
    expect(row.status).toBe("COMPLETED");
    expect(row.completed_at).toBeTruthy();
    expect(row.assessment).toMatchObject(local.assessment);
    expect(row.body_markers).toEqual(local.bodyMarkers);
    expect(row.body_map_note).toBe(local.bodyMapNote);
    expect(row.professional_note).toBe(local.professionalNote);
    expect(row.client_feeling).toBe(local.clientFeeling);
    expect(row.follow_up).toMatchObject(local.followUp);
    expect(row.suggested_tracking_areas).toEqual(local.suggestedTrackingAreas);
    expect(first.customerId).toBe(CUST_SHARED);
    expect(first.status).toBe("completed");
  });

  it("does not write when the browser customer is not the appointment customer", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointment = await seedAppointment(remote);
    const local = { ...localCompleted(appointment.id), customerId: "cust-other-person" };
    await expect(
      syncBrowserCompletedTreatment({
        identity: {
          organizationId: ORG_A,
          locationId: LOC_A1,
          appointmentId: appointment.id,
          customerId: CUST_SHARED,
          staffId: STAFF_A,
          serviceId: SVC_SHARED,
        },
        local,
        readRemote: async () => null,
        createRemote: () => {
          throw new Error("must not create");
        },
        completeRemote: () => {
          throw new Error("must not complete");
        },
      }),
    ).rejects.toThrow(BROWSER_SYNC_IDENTITY_MESSAGE);
    expect(db.treatments).toHaveLength(0);
  });

  it("does not overwrite a different remote treatment for the same appointment", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointment = await seedAppointment(remote);
    const local = localCompleted(appointment.id);
    const remoteDraft = await remote.treatments.create(ORG_A, {
      id: "trt-existing-aaaaaa",
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointment.id,
      createdBy: STAFF_A,
      draft: { ...local, professionalNote: "正式草稿的不同內容" },
    });
    await expect(
      syncBrowserCompletedTreatment({
        identity: {
          organizationId: ORG_A,
          locationId: LOC_A1,
          appointmentId: appointment.id,
          customerId: CUST_SHARED,
          staffId: STAFF_A,
          serviceId: SVC_SHARED,
        },
        local,
        readRemote: async () => remoteDraft,
        createRemote: () => {
          throw new Error("must not create");
        },
        completeRemote: () => {
          throw new Error("must not complete");
        },
      }),
    ).rejects.toThrow(BROWSER_SYNC_CONFLICT_MESSAGE);
    expect(db.treatments).toHaveLength(1);
    expect(db.treatments[0]?.status).toBe("DRAFT");
    expect(db.treatments[0]?.professional_note).toBe("正式草稿的不同內容");
  });
});

describe("browser completed hydration", () => {
  const identity = {
    organizationId: ORG_A,
    locationId: LOC_A1,
    appointmentId: "apt-nov19-abcdef",
    customerId: CUST_SHARED,
    staffId: STAFF_A,
    serviceId: SVC_SHARED,
  };

  it("shows a matching remote completion when the browser id is different", () => {
    const local = localCompleted(identity.appointmentId);
    const remote = normalizeTreatmentDraft(
      { ...local, id: "trt-synced-aaaaaa" },
      identity,
    );
    expect(decideBrowserCompletedHydration({
      remoteWrite: true,
      localRecords: [local],
      remote,
      identity,
    }).action).toBe("use-remote");
  });

  it("waits to complete a matching remote draft instead of inserting another row", () => {
    const local = localCompleted(identity.appointmentId);
    const remote = normalizeTreatmentDraft(
      { ...local, id: "trt-draft-aaaaaa", status: "draft" },
      identity,
    );
    expect(decideBrowserCompletedHydration({
      remoteWrite: true,
      localRecords: [local],
      remote,
      identity,
    }).action).toBe("sync");
  });

  it("does not sync a browser completion while remote write is off", () => {
    const decision = decideBrowserCompletedHydration({
      remoteWrite: false,
      localRecords: [localCompleted(identity.appointmentId)],
      remote: null,
      identity,
    });
    expect(decision).toEqual({ action: "stop", message: BROWSER_SYNC_PAUSE_MESSAGE });
  });

  it("stops when two browser completions share one appointment", () => {
    const local = localCompleted(identity.appointmentId);
    expect(decideBrowserCompletedHydration({
      remoteWrite: true,
      localRecords: [local, { ...local, id: "treatment-other" }],
      remote: null,
      identity,
    }).action).toBe("stop");
  });

  it("stops when the browser customer does not match the appointment", () => {
    const decision = decideBrowserCompletedHydration({
      remoteWrite: true,
      localRecords: [{ ...localCompleted(identity.appointmentId), customerId: "cust-other" }],
      remote: null,
      identity,
    });
    expect(decision).toEqual({ action: "stop", message: BROWSER_SYNC_IDENTITY_MESSAGE });
  });

  it("does not replace a remote completion that has different clinical content", () => {
    const local = localCompleted(identity.appointmentId);
    const remote = normalizeTreatmentDraft(
      { ...local, id: "trt-other-aaaaaa", professionalNote: "不同內容" },
      identity,
    );
    const decision = decideBrowserCompletedHydration({
      remoteWrite: true,
      localRecords: [local],
      remote,
      identity,
    });
    expect(decision).toEqual({ action: "stop", message: BROWSER_SYNC_CONFLICT_MESSAGE });
  });
});
