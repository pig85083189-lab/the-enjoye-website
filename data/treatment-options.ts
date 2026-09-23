/** @deprecated Prefer template-driven options via getTreatmentTemplate */
export { SENSITIVITY_LEVELS, CLIENT_FEELINGS } from "@/types/treatment";

export function getBodyAreaLabel(
  area: string,
  areas?: Array<{ id: string; label: string }>,
): string {
  return areas?.find((item) => item.id === area)?.label ?? area;
}
