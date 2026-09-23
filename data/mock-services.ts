import type { Service } from "@/types";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { SEED_LUMIERE_SERVICES } from "@/data/seed-organizations";

export const mockServices: Service[] = [
  {
    id: "svc-breast",
    organizationId: ORG_ENJOYE_ID,
    name: "性感美胸 SPA",
    durationMinutes: 100,
    category: "美胸",
    serviceType: "BREAST",
    priceMinor: 3200,
  },
  {
    id: "svc-facial",
    organizationId: ORG_ENJOYE_ID,
    name: "臉部保養 SPA",
    durationMinutes: 90,
    category: "臉部",
    serviceType: "FACIAL",
    priceMinor: 2800,
  },
  {
    id: "svc-curve",
    organizationId: ORG_ENJOYE_ID,
    name: "窈窕曲線 SPA",
    durationMinutes: 100,
    category: "曲線",
    serviceType: "BODY_SCULPTING",
    priceMinor: 3500,
  },
  {
    id: "svc-womb",
    organizationId: ORG_ENJOYE_ID,
    name: "暖宮 SPA",
    durationMinutes: 90,
    category: "暖宮",
    serviceType: "WOMB_CARE",
    priceMinor: 2600,
  },
];

/** Tenant-owned service catalog — always organization scoped. */
export function getServicesForOrganization(organizationId: string): Service[] {
  if (organizationId === ORG_ENJOYE_ID) return mockServices;
  return SEED_LUMIERE_SERVICES.filter((s) => s.organizationId === organizationId);
}

/**
 * Tenant-owned service lookup. organizationId is required.
 * There is no global platform service catalog in this prototype.
 */
export function getServiceById(
  id: string,
  organizationId: string,
): Service | undefined {
  return getServicesForOrganization(organizationId).find((service) => service.id === id);
}
