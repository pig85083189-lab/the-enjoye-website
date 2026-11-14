export type ConsultationFieldType = "single" | "multi" | "text" | "date" | "rating";
export type ConsultationSection = "assessment" | "professionalNote";
export interface ConsultationField {
  id: string;
  label: string;
  section: ConsultationSection;
  type: ConsultationFieldType;
  options: string[];
  enabled: boolean;
}
export const DEFAULT_CONSULTATION_FIELDS: ConsultationField[] = [
  { id: "suitable-products", label: "適合產品", section: "assessment", type: "multi", options: [], enabled: true },
  { id: "focus-areas", label: "加強部位", section: "assessment", type: "multi", options: [], enabled: true },
  { id: "assessment-note", label: "備註", section: "assessment", type: "text", options: [], enabled: true },
  { id: "next-course", label: "下次推薦課程", section: "professionalNote", type: "multi", options: [], enabled: true },
  { id: "recommendation-reason", label: "推薦課程原因", section: "professionalNote", type: "text", options: [], enabled: true },
  { id: "next-care-date", label: "建議下次保養時間", section: "professionalNote", type: "date", options: [], enabled: true },
  { id: "energy-rating", label: "客戶能量評分", section: "professionalNote", type: "rating", options: [], enabled: true },
];
const key = (organizationId: string) => `beauty-os:consultation-fields:v1:${organizationId}`;
export function loadConsultationFields(organizationId: string): ConsultationField[] {
  if (typeof window === "undefined" || !organizationId || organizationId === "ssr") return DEFAULT_CONSULTATION_FIELDS;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(organizationId)) ?? "null");
    if (!Array.isArray(value)) return DEFAULT_CONSULTATION_FIELDS;
    return value.filter((field): field is ConsultationField =>
      typeof field === "object" && field !== null &&
      typeof field.id === "string" && typeof field.label === "string" &&
      (field.section === "assessment" || field.section === "professionalNote") &&
      ["single", "multi", "text", "date", "rating"].includes(field.type) &&
      Array.isArray(field.options) && field.options.every((option: unknown) => typeof option === "string") &&
      typeof field.enabled === "boolean");
  } catch { return DEFAULT_CONSULTATION_FIELDS; }
}
export function saveConsultationFields(organizationId: string, fields: ConsultationField[]): void {
  if (typeof window === "undefined" || !organizationId || organizationId === "ssr") return;
  localStorage.setItem(key(organizationId), JSON.stringify(fields));
}
