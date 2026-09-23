import type { TreatmentServiceType, TreatmentTemplate } from "@/types/treatment-template";
import { getServiceById } from "@/data/mock-services";
import { BREAST_TEMPLATE } from "./breast";
import { GENERIC_TEMPLATE } from "./generic";

const TEMPLATE_BY_TYPE: Partial<Record<TreatmentServiceType, TreatmentTemplate>> = {
  BREAST: BREAST_TEMPLATE,
  GENERIC: GENERIC_TEMPLATE,
};

/**
 * Resolve serviceType from tenant-scoped Service record first (preferred),
 * with serviceId fallback for legacy data.
 */
export function resolveServiceType(
  serviceId: string,
  organizationId: string,
): TreatmentServiceType {
  const service = getServiceById(serviceId, organizationId);
  if (service?.serviceType) return service.serviceType;

  switch (serviceId) {
    case "svc-breast":
      return "BREAST";
    case "svc-facial":
      return "FACIAL";
    case "svc-curve":
      return "BODY_SCULPTING";
    case "svc-womb":
      return "WOMB_CARE";
    default:
      return "GENERIC";
  }
}

export function getTreatmentTemplate(
  serviceTypeOrId: TreatmentServiceType | string,
  organizationId?: string,
): TreatmentTemplate {
  const asType = serviceTypeOrId as TreatmentServiceType;
  if (TEMPLATE_BY_TYPE[asType]) {
    return TEMPLATE_BY_TYPE[asType]!;
  }

  if (!organizationId) {
    return GENERIC_TEMPLATE;
  }

  const resolved = resolveServiceType(serviceTypeOrId, organizationId);
  return TEMPLATE_BY_TYPE[resolved] ?? GENERIC_TEMPLATE;
}

export function getTreatmentTemplateForService(
  serviceId: string,
  organizationId: string,
): TreatmentTemplate {
  return getTreatmentTemplate(resolveServiceType(serviceId, organizationId), organizationId);
}

export { BREAST_TEMPLATE, GENERIC_TEMPLATE };
