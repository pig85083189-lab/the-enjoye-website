import { migrateLegacyTenantStorage } from "@/lib/tenant/migration";
import {
  getTenantStorageKey,
  type TenantResource,
} from "@/lib/tenant/storage-keys";
import { readJson, writeJson } from "./storage";

/** Read tenant-scoped JSON after idempotent legacy migration. */
export function readTenantJson<T>(
  organizationId: string,
  resource: TenantResource,
  fallback: T,
): T {
  migrateLegacyTenantStorage(organizationId);
  return readJson<T>(getTenantStorageKey(organizationId, resource), fallback);
}

export function writeTenantJson<T>(
  organizationId: string,
  resource: TenantResource,
  value: T,
  eventDetail?: string,
): void {
  writeJson(
    getTenantStorageKey(organizationId, resource),
    value,
    eventDetail ?? `${resource}:${organizationId}`,
  );
}
