import type { Service } from "@/types";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { SEED_LUMIERE_SERVICES } from "@/data/seed-organizations";

/**
 * Built-in operational service catalog (not the public /prices menu).
 * Seed IDs are stable identities — overlay CRUD must never regenerate them.
 */
export const mockServices: Service[] = [
  {
    id: "svc-breast",
    organizationId: ORG_ENJOYE_ID,
    name: "性感美胸 SPA",
    durationMinutes: 100,
    category: "美胸",
    serviceType: "BREAST",
    priceMinor: 3200,
    isActive: true,
  },
  {
    id: "svc-facial",
    organizationId: ORG_ENJOYE_ID,
    name: "臉部保養 SPA",
    durationMinutes: 90,
    category: "臉部",
    serviceType: "FACIAL",
    priceMinor: 2800,
    isActive: true,
  },
  {
    id: "svc-curve",
    organizationId: ORG_ENJOYE_ID,
    name: "窈窕曲線 SPA",
    durationMinutes: 100,
    category: "曲線",
    serviceType: "BODY_SCULPTING",
    priceMinor: 3500,
    isActive: true,
  },
  {
    id: "svc-womb",
    organizationId: ORG_ENJOYE_ID,
    name: "暖宮 SPA",
    durationMinutes: 90,
    category: "暖宮",
    serviceType: "WOMB_CARE",
    priceMinor: 2600,
    isActive: true,
  },
];

export function getSeedServicesForOrganization(organizationId: string): Service[] {
  if (organizationId === ORG_ENJOYE_ID) return mockServices;
  return SEED_LUMIERE_SERVICES.filter((service) => service.organizationId === organizationId);
}
