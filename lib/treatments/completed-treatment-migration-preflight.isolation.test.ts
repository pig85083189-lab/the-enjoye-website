import { describe, expect, it } from "vitest";
import type { TreatmentDraft } from "@/types/treatment";
import {
  completedTreatmentClinicalFieldsMatch,
  preflightCompletedTreatmentMigration,
} from "./completed-treatment-migration-preflight";

const org = "org-real";
function record(overrides: Partial<TreatmentDraft> = {}): TreatmentDraft {
  return {
    id: "treatment-1", organizationId: org, locationId: "location-1",
    appointmentId: "appointment-1", customerId: "customer-1",
    staffId: "staff-1", serviceId: "service-1",
    status: "completed", currentStep: "complete", furthestStep: "complete",
    mode: "STANDARD", skippedSteps: [], suggestedTrackingAreas: [],
    assessment: { concerns: [], clientFocus: "需要保養", sensitivityLevel: 0 },
    bodyMarkers: [{ id: "marker-1", area: "left_upper_arm", conditions: ["緊繃"], note: "觀察" }],
    bodyMapNote: "", operations: [], products: [], photos: [],
    professionalNote: "有改善", selectedQuickPhrases: [],
    noteManuallyEdited: true, clientFeeling: "有改善", discomfortNote: "",
    followUp: { tags: [], suggestedDate: "2026-11-21", note: "", suggestNextBooking: false },
    createdAt: "2026-11-19T01:00:00.000Z", updatedAt: "2026-11-19T02:00:00.000Z",
    ...overrides,
  };
}

describe("completed treatment migration preflight", () => {
  it("requires authoritative identity verification before first remote write", () => {
    expect(preflightCompletedTreatmentMigration(org, [record()], [])[0].status)
      .toBe("needs-identity-verification");
  });
  it("rejects missing location and does not authorize migration", () => {
    expect(preflightCompletedTreatmentMigration(org, [record({ locationId: undefined })], [])[0].status)
      .toBe("blocked");
  });
  it("blocks duplicate local appointments for every affected record", () => {
    const rows = [record(), record({ id: "treatment-2" })];
    expect(preflightCompletedTreatmentMigration(org, rows, []).map((result) => result.status))
      .toEqual(["blocked", "blocked"]);
  });
  it("blocks mismatched remote customer", () => {
    const result = preflightCompletedTreatmentMigration(
      org, [record()], [record({ customerId: "different-customer" })],
    );
    expect(result[0].status).toBe("blocked");
  });
  it("blocks clinical differences even when identifiers match", () => {
    const result = preflightCompletedTreatmentMigration(
      org, [record()], [record({ professionalNote: "" })],
    );
    expect(result[0].status).toBe("blocked");
  });
  it("blocks a remote draft from masking a completed browser record", () => {
    const result = preflightCompletedTreatmentMigration(
      org, [record()], [record({ status: "draft" })],
    );
    expect(result[0].status).toBe("blocked");
  });
  it("blocks an existing remote record with the same appointment but different ID", () => {
    const result = preflightCompletedTreatmentMigration(
      org, [record()], [record({ id: "another-treatment" })],
    );
    expect(result[0].status).toBe("blocked");
  });
  it("only accepts fully matching remote records as already present", () => {
    expect(preflightCompletedTreatmentMigration(org, [record()], [record()])[0].status)
      .toBe("already-remote");
  });
  it("detects changes to body markers and follow-up", () => {
    expect(completedTreatmentClinicalFieldsMatch(record(), record({ bodyMarkers: [] }))).toBe(false);
    expect(completedTreatmentClinicalFieldsMatch(record(), record({
      followUp: { tags: [], suggestedDate: "", note: "", suggestNextBooking: false },
    }))).toBe(false);
  });
  it("blocks mismatched remote staff or service even when clinical fields match", () => {
    expect(preflightCompletedTreatmentMigration(org, [record()], [record({ staffId: "another-staff" })])[0].status)
      .toBe("blocked");
    expect(preflightCompletedTreatmentMigration(org, [record()], [record({ serviceId: "another-service" })])[0].status)
      .toBe("blocked");
  });
  it("blocks multiple remote rows for the same appointment", () => {
    const result = preflightCompletedTreatmentMigration(
      org, [record()], [record(), record({ id: "another-treatment" })],
    );
    expect(result[0].status).toBe("blocked");
  });

  it("rejects every changed member-visible clinical field", () => {
    const baseline = record({
      assessment: { concerns: ["乾燥"], clientFocus: "需要保養", sensitivityLevel: 1 },
      bodyMapNote: "胸口敏感",
      operations: ["operation-1"],
      products: ["product-1"],
      professionalNote: "服務紀錄",
      clientFeeling: "不舒服",
      discomfortNote: "胸口不適",
      followUp: { tags: ["保濕"], suggestedDate: "2026-11-21", note: "下次追蹤", suggestNextBooking: true },
    });
    const variants: Partial<TreatmentDraft>[] = [
      { assessment: { ...baseline.assessment, clientFocus: "不同評估" } },
      { bodyMarkers: [] },
      { bodyMapNote: "不同標記備註" },
      { operations: [] },
      { products: [] },
      { professionalNote: "不同服務紀錄" },
      { clientFeeling: "不同感受" },
      { discomfortNote: "不同不適" },
      { followUp: { ...baseline.followUp, note: "不同追蹤" } },
    ];
    for (const changes of variants) {
      const remote = { ...baseline, ...changes };
      expect(completedTreatmentClinicalFieldsMatch(baseline, remote)).toBe(false);
      expect(preflightCompletedTreatmentMigration(org, [baseline], [remote])[0].status).toBe("blocked");
    }
  });
  it("rejects changed photo metadata without uploading photos", () => {
    const local = record({ photos: [{
      id: "photo-1", treatmentId: "treatment-1", type: "BEFORE",
      createdAt: "2026-11-19T01:00:00.000Z", hadPreview: true,
    }] });
    expect(completedTreatmentClinicalFieldsMatch(local, record())).toBe(false);
  });

});
