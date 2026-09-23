import type { AppointmentStatus } from "./index";
import type { AssessmentComparison } from "./treatment-template";

export type TreatmentStepId =
  | "summary"
  | "assessment"
  | "bodyMap"
  | "operations"
  | "photos"
  | "professionalNote"
  | "followUp"
  | "complete";

export type TreatmentStatus = "draft" | "completed";

export type PhotoType = "BEFORE" | "AFTER";

/** Legacy breast area ids — kept for draft compatibility */
export type BodyAreaId =
  | "left_armpit"
  | "right_armpit"
  | "left_upper_breast"
  | "right_upper_breast"
  | "left_outer_breast"
  | "right_outer_breast"
  | "left_lower_breast"
  | "right_lower_breast"
  | "sternum"
  | "left_upper_arm"
  | "right_upper_arm"
  | string;

export type BodyCondition = string;

export interface TreatmentAssessment {
  concerns: string[];
  clientFocus: string;
  sensitivityLevel: number;
  /** Phase 2.5: comparison to last visit */
  comparisonToLast?: AssessmentComparison;
}

export interface BodyMarker {
  id: string;
  area: string;
  conditions: string[];
  note: string;
}

export interface TreatmentOperation {
  id: string;
  label: string;
  category: "lymph" | "acupoint" | "technique" | "device" | string;
}

export interface TreatmentProduct {
  id: string;
  label: string;
}

export interface TreatmentPhoto {
  id: string;
  organizationId?: string;
  treatmentId: string;
  type: PhotoType;
  previewUrl: string;
  createdAt: string;
}

export interface TreatmentPhotoMeta {
  id: string;
  treatmentId: string;
  type: PhotoType;
  createdAt: string;
  hadPreview: boolean;
}

export interface TreatmentNote {
  professionalNote: string;
  clientFeeling: string;
  discomfortNote: string;
}

export interface TreatmentFollowUp {
  tags: string[];
  suggestedDate: string;
  note: string;
  suggestNextBooking: boolean;
}

export interface TreatmentDraft {
  id: string;
  organizationId: string;
  locationId?: string;
  appointmentId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  status: TreatmentStatus;
  currentStep: TreatmentStepId;
  furthestStep: TreatmentStepId;
  /** STANDARD full flow or QUICK returning-customer flow */
  mode: "STANDARD" | "QUICK";
  skippedSteps: TreatmentStepId[];
  /** Suggested body-map areas from previous follow-up (not auto markers) */
  suggestedTrackingAreas: string[];
  quickRecordAppliedAt?: string;
  assessment: TreatmentAssessment;
  bodyMarkers: BodyMarker[];
  bodyMapNote: string;
  operations: string[];
  products: string[];
  photos: TreatmentPhotoMeta[];
  professionalNote: string;
  /** Selected quick phrase labels for chip UI */
  selectedQuickPhrases: string[];
  /** True once beautician edits the note textarea manually */
  noteManuallyEdited: boolean;
  clientFeeling: string;
  discomfortNote: string;
  followUp: TreatmentFollowUp;
  createdAt: string;
  updatedAt: string;
}

export type AppointmentStatusMap = Record<string, AppointmentStatus>;

export const TREATMENT_STEPS: Array<{ id: TreatmentStepId; label: string; short: string }> = [
  { id: "summary", label: "客戶摘要", short: "摘要" },
  { id: "assessment", label: "今日評估", short: "評估" },
  { id: "bodyMap", label: "部位紀錄", short: "部位" },
  { id: "operations", label: "操作項目", short: "操作" },
  { id: "photos", label: "照片紀錄", short: "照片" },
  { id: "professionalNote", label: "專業紀錄", short: "紀錄" },
  { id: "followUp", label: "下次追蹤", short: "追蹤" },
  { id: "complete", label: "完成", short: "完成" },
];

/** Optional steps that can be skipped */
export const OPTIONAL_STEPS: TreatmentStepId[] = ["bodyMap", "photos", "followUp"];

export function isOptionalStep(step: TreatmentStepId): boolean {
  return OPTIONAL_STEPS.includes(step);
}

export const CLIENT_FEELINGS = [
  "很放鬆",
  "有改善",
  "無明顯差異",
  "較敏感",
  "不舒服",
  "其他",
] as const;

export const SENSITIVITY_LEVELS = [
  { value: 0, label: "0 無" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5 明顯" },
] as const;
