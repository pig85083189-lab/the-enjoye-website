/**
 * Service domain ↔ remote public.services mapping.
 * Column names come from the applied foundation + operational migrations.
 * Do not write the legacy numeric `price` column — SoT is price_minor.
 */

import type { Service } from "@/types";
import type { TreatmentServiceType } from "@/types/treatment-template";
import type { DbService, RemoteServiceType } from "./operational-rows";

export const REMOTE_SERVICE_COLUMNS = [
  "id",
  "organization_id",
  "app_id",
  "name",
  "service_type",
  "duration_minutes",
  "price_minor",
  "currency",
  "category",
  "is_active",
  "created_at",
  "updated_at",
] as const;

/**
 * Domain TreatmentServiceType → public.service_type.
 * Only documented aliases; unknown values fail closed.
 */
export const DOMAIN_TO_REMOTE_SERVICE_TYPE = {
  BREAST: "BREAST",
  BODY_SCULPTING: "BODY_SCULPTING",
  FACIAL: "FACIAL",
  WOMB_CARE: "WOMB_CARE",
  ACID_DRAIN: "DETOX",
  BELLY_CANDLE: "NAVEL_CANDLE",
  EXFOLIATION: "EXFOLIATION",
  MICRONEEDLE: "OTHER",
  GENERIC: "OTHER",
} as const satisfies Record<TreatmentServiceType, RemoteServiceType>;

export const REMOTE_TO_DOMAIN_SERVICE_TYPE = {
  BREAST: "BREAST",
  BODY_SCULPTING: "BODY_SCULPTING",
  FACIAL: "FACIAL",
  WOMB_CARE: "WOMB_CARE",
  DETOX: "ACID_DRAIN",
  NAVEL_CANDLE: "BELLY_CANDLE",
  EXFOLIATION: "EXFOLIATION",
  WAXING: "GENERIC",
  OTHER: "GENERIC",
} as const satisfies Record<RemoteServiceType, TreatmentServiceType>;

export function toRemoteServiceType(serviceType: TreatmentServiceType): RemoteServiceType {
  const mapped = DOMAIN_TO_REMOTE_SERVICE_TYPE[serviceType];
  if (!mapped) {
    throw new Error(`Unsupported serviceType ${JSON.stringify(serviceType)}`);
  }
  return mapped;
}

export function fromRemoteServiceType(serviceType: RemoteServiceType): TreatmentServiceType {
  const mapped = REMOTE_TO_DOMAIN_SERVICE_TYPE[serviceType];
  if (!mapped) {
    throw new Error(`Unsupported remote service_type ${JSON.stringify(serviceType)}`);
  }
  return mapped;
}

export function remoteServicePayload(row: DbService): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const column of REMOTE_SERVICE_COLUMNS) {
    payload[column] = row[column];
  }
  if ("price" in payload || "remainingSessions" in payload) {
    throw new Error("service remote payload leaked unsupported columns");
  }
  return payload;
}

export function serviceFromRemoteRow(organizationAppId: string, row: DbService): Service {
  return {
    id: row.app_id,
    organizationId: organizationAppId,
    name: row.name,
    durationMinutes: row.duration_minutes,
    category: row.category ?? "",
    serviceType: fromRemoteServiceType(row.service_type),
    priceMinor: row.price_minor ?? undefined,
    isActive: row.is_active,
  };
}
