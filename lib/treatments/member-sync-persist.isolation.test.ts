import { describe, expect, it } from "vitest";
import type { TreatmentDraft } from "@/types/treatment";
import { memberSyncPersistDecision } from "./member-sync-persist";

const draft = {
  id: "trt-abc-def",
  appointmentId: "apt-abc-def",
  customerId: "cust-1",
  status: "completed",
  photos: [],
  assessment: {},
  bodyMarkers: [],
  bodyMapNote: "",
  operations: [],
  products: [],
  professionalNote: "",
  clientFeeling: "",
  discomfortNote: "",
  followUp: {},
  skippedSteps: [],
  suggestedTrackingAreas: [],
  selectedQuickPhrases: [],
  noteManuallyEdited: false,
  mode: "STANDARD",
} as unknown as TreatmentDraft;

describe("member sync persist decision", () => {
  it("rejects a browser customer that is not the appointment customer", () => {
    expect(memberSyncPersistDecision({
      draftCustomerId: "cust-other",
      appointmentCustomerId: "cust-1",
      existing: null,
      draft,
      remoteClinical: null,
    })).toBe("reject-customer");
  });

  it("creates once and retries the same completed treatment", () => {
    expect(memberSyncPersistDecision({
      draftCustomerId: "cust-1",
      appointmentCustomerId: "cust-1",
      existing: null,
      draft,
      remoteClinical: null,
    })).toBe("create");
    expect(memberSyncPersistDecision({
      draftCustomerId: "cust-1",
      appointmentCustomerId: "cust-1",
      existing: { id: draft.id, customerId: "cust-1", appointmentId: draft.appointmentId, status: "completed" },
      draft,
      remoteClinical: draft,
    })).toBe("retry");
  });

  it("does not replace a different treatment on the same appointment", () => {
    expect(memberSyncPersistDecision({
      draftCustomerId: "cust-1",
      appointmentCustomerId: "cust-1",
      existing: { id: "trt-other-row", customerId: "cust-1", appointmentId: draft.appointmentId, status: "completed" },
      draft,
      remoteClinical: draft,
    })).toBe("reject-conflict");
  });
});
