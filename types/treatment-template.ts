export type TreatmentServiceType =
  | "BREAST"
  | "BODY_SCULPTING"
  | "FACIAL"
  | "WOMB_CARE"
  | "ACID_DRAIN"
  | "BELLY_CANDLE"
  | "EXFOLIATION"
  | "MICRONEEDLE"
  | "GENERIC";

export type BodyMapType =
  | "BREAST"
  | "BODY_FRONT"
  | "BODY_BACK"
  | "FACE"
  | "ABDOMEN"
  | "GENERIC";

export interface TemplateBodyArea {
  id: string;
  label: string;
  /** Optional SVG hit region hint */
  cx?: number;
  cy?: number;
  r?: number;
}

export interface TemplateOperationItem {
  id: string;
  label: string;
}

export interface TemplateOperationGroup {
  id: string;
  title: string;
  items: TemplateOperationItem[];
}

export interface TemplateProduct {
  id: string;
  label: string;
}

export interface TreatmentTemplate {
  id: string;
  serviceType: TreatmentServiceType;
  name: string;
  description: string;
  assessmentOptions: string[];
  bodyMapType: BodyMapType;
  bodyAreas: TemplateBodyArea[];
  bodyConditions: string[];
  operationGroups: TemplateOperationGroup[];
  products: TemplateProduct[];
  quickPhrases: string[];
  /** phrase label → natural sentence fragment */
  quickPhraseTextMap: Record<string, string>;
  followUpOptions: string[];
  /** operation item ids for one-tap protocol */
  standardProtocol: string[];
  photoGuidelines: string;
  isGeneric?: boolean;
}

export type AssessmentComparison =
  | "same_as_last"
  | "new_conditions"
  | "improved"
  | "needs_attention"
  | "";
