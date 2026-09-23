import type { TreatmentDraft } from "@/types/treatment";
import type { OrgCustomerQuery, OrgEntityQuery, TreatmentRepository } from "./interfaces";
import { getCompletedTreatmentsForCustomer } from "@/lib/treatment-draft";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { readTenantJson } from "./tenant-read";

/** Seed completed treatments for CRM history (prototype only) */
export const SEED_COMPLETED_TREATMENTS: TreatmentDraft[] = [
  {
    id: "treatment-seed-001",
    organizationId: ORG_ENJOYE_ID,
    appointmentId: "apt-001c",
    customerId: "demo-001",
    staffId: "staff-001",
    serviceId: "svc-breast",
    status: "completed",
    currentStep: "complete",
    furthestStep: "complete",
    mode: "STANDARD",
    skippedSteps: [],
    suggestedTrackingAreas: ["右側腋下", "胸上緣"],
    assessment: {
      concerns: ["外擴", "腋下緊繃"],
      clientFocus: "希望改善右腋下緊繃",
      sensitivityLevel: 2,
      comparisonToLast: "improved",
    },
    bodyMarkers: [],
    bodyMapNote: "右腋下偏緊",
    operations: ["淋巴疏通", "美胸塑型"],
    products: ["舒緩按摩油"],
    photos: [],
    professionalNote: "右腋下仍偏緊，外擴有輕微改善。建議維持居家保養。",
    selectedQuickPhrases: [],
    noteManuallyEdited: true,
    clientFeeling: "放鬆舒適",
    discomfortNote: "",
    followUp: {
      tags: ["右腋下緊繃", "外擴"],
      suggestedDate: "2026-09-25",
      note: "下次持續追蹤右腋下",
      suggestNextBooking: true,
    },
    createdAt: "2026-09-10T10:00:00+08:00",
    updatedAt: "2026-09-10T11:40:00+08:00",
  },
  {
    id: "treatment-seed-001b",
    organizationId: ORG_ENJOYE_ID,
    appointmentId: "apt-001d",
    customerId: "demo-001",
    staffId: "staff-001",
    serviceId: "svc-breast",
    status: "completed",
    currentStep: "complete",
    furthestStep: "complete",
    mode: "QUICK",
    skippedSteps: ["photos"],
    suggestedTrackingAreas: [],
    assessment: {
      concerns: ["外擴"],
      clientFocus: "",
      sensitivityLevel: 1,
      comparisonToLast: "same_as_last",
    },
    bodyMarkers: [],
    bodyMapNote: "",
    operations: ["美胸保養"],
    products: ["滋養霜"],
    photos: [],
    professionalNote: "狀態穩定，維持節奏即可。",
    selectedQuickPhrases: [],
    noteManuallyEdited: true,
    clientFeeling: "很好",
    discomfortNote: "",
    followUp: {
      tags: ["外擴"],
      suggestedDate: "",
      note: "",
      suggestNextBooking: false,
    },
    createdAt: "2026-08-15T14:00:00+08:00",
    updatedAt: "2026-08-15T15:40:00+08:00",
  },
  {
    id: "treatment-seed-001c",
    organizationId: ORG_ENJOYE_ID,
    appointmentId: "apt-seed-older",
    customerId: "demo-001",
    staffId: "staff-001",
    serviceId: "svc-breast",
    status: "completed",
    currentStep: "complete",
    furthestStep: "complete",
    mode: "STANDARD",
    skippedSteps: [],
    suggestedTrackingAreas: [],
    assessment: {
      concerns: ["經前脹痛"],
      clientFocus: "",
      sensitivityLevel: 2,
      comparisonToLast: "",
    },
    bodyMarkers: [],
    bodyMapNote: "",
    operations: ["美胸保養"],
    products: [],
    photos: [],
    professionalNote: "經期前脹痛明顯，已提醒居家照護。",
    selectedQuickPhrases: [],
    noteManuallyEdited: true,
    clientFeeling: "舒服",
    discomfortNote: "",
    followUp: {
      tags: ["經前脹痛"],
      suggestedDate: "",
      note: "",
      suggestNextBooking: true,
    },
    createdAt: "2026-07-20T11:00:00+08:00",
    updatedAt: "2026-07-20T12:40:00+08:00",
  },
  {
    id: "treatment-seed-004",
    organizationId: ORG_ENJOYE_ID,
    appointmentId: "apt-seed-004",
    customerId: "demo-004",
    staffId: "staff-001",
    serviceId: "svc-womb",
    status: "completed",
    currentStep: "complete",
    furthestStep: "complete",
    mode: "STANDARD",
    skippedSteps: [],
    suggestedTrackingAreas: ["腹部溫感"],
    assessment: {
      concerns: ["宮寒"],
      clientFocus: "想改善循環",
      sensitivityLevel: 1,
      comparisonToLast: "",
    },
    bodyMarkers: [],
    bodyMapNote: "",
    operations: ["暖宮護理"],
    products: ["暖宮精油"],
    photos: [],
    professionalNote: "腹部溫感偏弱，建議保暖。",
    selectedQuickPhrases: [],
    noteManuallyEdited: true,
    clientFeeling: "溫暖放鬆",
    discomfortNote: "",
    followUp: {
      tags: ["腹部溫感"],
      suggestedDate: "2026-09-18",
      note: "",
      suggestNextBooking: true,
    },
    createdAt: "2026-09-05T16:00:00+08:00",
    updatedAt: "2026-09-05T17:30:00+08:00",
  },
  {
    id: "treatment-seed-006",
    organizationId: ORG_ENJOYE_ID,
    appointmentId: "apt-seed-006",
    customerId: "demo-006",
    staffId: "staff-001",
    serviceId: "svc-breast",
    status: "completed",
    currentStep: "complete",
    furthestStep: "complete",
    mode: "STANDARD",
    skippedSteps: [],
    suggestedTrackingAreas: ["胸型左右差異"],
    assessment: {
      concerns: ["大小胸"],
      clientFocus: "",
      sensitivityLevel: 1,
      comparisonToLast: "improved",
    },
    bodyMarkers: [],
    bodyMapNote: "",
    operations: ["美胸塑型"],
    products: [],
    photos: [],
    professionalNote: "左右差異持續改善，居家保養有執行。",
    selectedQuickPhrases: [],
    noteManuallyEdited: true,
    clientFeeling: "滿意",
    discomfortNote: "",
    followUp: {
      tags: ["胸型左右差異", "居家保養追蹤"],
      suggestedDate: "2026-09-28",
      note: "",
      suggestNextBooking: true,
    },
    createdAt: "2026-09-12T11:00:00+08:00",
    updatedAt: "2026-09-12T12:40:00+08:00",
  },
  {
    id: "treatment-seed-007",
    organizationId: ORG_ENJOYE_ID,
    appointmentId: "apt-007",
    customerId: "demo-007",
    staffId: "staff-001",
    serviceId: "svc-curve",
    status: "completed",
    currentStep: "complete",
    furthestStep: "complete",
    mode: "STANDARD",
    skippedSteps: ["photos"],
    suggestedTrackingAreas: ["右腋下緊繃"],
    assessment: {
      concerns: ["肩頸緊繃"],
      clientFocus: "",
      sensitivityLevel: 2,
      comparisonToLast: "",
    },
    bodyMarkers: [],
    bodyMapNote: "",
    operations: ["肩頸放鬆"],
    products: [],
    photos: [],
    professionalNote: "肩頸有改善，右腋下仍需追蹤。",
    selectedQuickPhrases: [],
    noteManuallyEdited: true,
    clientFeeling: "酸痛緩解",
    discomfortNote: "",
    followUp: {
      tags: ["右腋下緊繃", "肩頸放鬆"],
      suggestedDate: "",
      note: "建議主動約回診",
      suggestNextBooking: true,
    },
    createdAt: "2026-08-20T15:00:00+08:00",
    updatedAt: "2026-08-20T16:40:00+08:00",
  },
];

function mergeSeedWithStored(
  organizationId: string,
  customerId: string,
): TreatmentDraft[] {
  const fromStore =
    typeof window !== "undefined"
      ? getCompletedTreatmentsForCustomer(organizationId, customerId)
      : [];
  const seed = SEED_COMPLETED_TREATMENTS.filter(
    (t) => t.customerId === customerId && t.organizationId === organizationId,
  );
  const byId = new Map<string, TreatmentDraft>();
  for (const t of seed) byId.set(t.id, t);
  for (const t of fromStore) {
    if (t.organizationId && t.organizationId !== organizationId) continue;
    byId.set(t.id, { ...t, organizationId });
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export class LocalTreatmentRepository implements TreatmentRepository {
  listByCustomer(query: OrgCustomerQuery): TreatmentDraft[] {
    return mergeSeedWithStored(query.organizationId, query.customerId);
  }

  getById(query: OrgEntityQuery): TreatmentDraft | undefined {
    if (typeof window !== "undefined") {
      const stored = readTenantJson<TreatmentDraft[]>(
        query.organizationId,
        "treatments-completed",
        [],
      );
      const found = stored.find(
        (t) =>
          t.id === query.id &&
          (!t.organizationId || t.organizationId === query.organizationId),
      );
      if (found) return { ...found, organizationId: query.organizationId };
    }
    return SEED_COMPLETED_TREATMENTS.find(
      (t) => t.id === query.id && t.organizationId === query.organizationId,
    );
  }
}

export const localTreatmentRepository = new LocalTreatmentRepository();
