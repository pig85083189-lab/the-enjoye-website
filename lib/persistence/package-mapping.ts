import type {
  CustomerPackage,
  PackageDefinition,
  PackageLedgerEntry,
  PackageServiceEntitlement,
} from "@/lib/packages/domain";
import type {
  DbCustomerPackage,
  DbPackageDefinition,
  DbPackageLedgerEntry,
} from "./operational-rows";

export const REMOTE_PACKAGE_DEFINITION_COLUMNS = [
  "id",
  "organization_id",
  "app_id",
  "name",
  "description",
  "included_services",
  "session_count",
  "price_minor",
  "currency",
  "validity_days",
  "is_active",
  "created_at",
  "updated_at",
] as const;

export const REMOTE_CUSTOMER_PACKAGE_COLUMNS = [
  "id",
  "organization_id",
  "customer_id",
  "package_definition_id",
  "purchase_transaction_id",
  "app_id",
  "name_snapshot",
  "session_count_snapshot",
  "price_snapshot_minor",
  "included_service_ids_snapshot",
  "purchased_at",
  "activated_at",
  "expires_at",
  "status",
  "created_at",
  "updated_at",
] as const;

export const REMOTE_PACKAGE_LEDGER_COLUMNS = [
  "id",
  "organization_id",
  "customer_package_id",
  "customer_id",
  "app_id",
  "type",
  "session_delta",
  "service_id",
  "appointment_id",
  "treatment_id",
  "transaction_id",
  "location_id",
  "reason",
  "effect_key",
  "reverses_entry_id",
  "created_by_staff_id",
  "created_at",
] as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function includedServicesFromUnknown(value: unknown): PackageServiceEntitlement[] {
  if (!Array.isArray(value)) return [];
  const out: PackageServiceEntitlement[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const serviceId = asString((row as { serviceId?: unknown }).serviceId);
    if (!serviceId) continue;
    out.push({ serviceId, sessionsPerRedemption: 1 });
  }
  return out;
}

export function dbPackageDefinitionFromUnknown(
  row: Record<string, unknown>,
): DbPackageDefinition {
  const id = asString(row.id);
  const organization_id = asString(row.organization_id);
  const app_id = asString(row.app_id);
  const name = asString(row.name);
  const session_count = asNumber(row.session_count);
  const price_minor = asNumber(row.price_minor);
  const created_at = asString(row.created_at);
  const updated_at = asString(row.updated_at);
  if (
    !id ||
    !organization_id ||
    !app_id ||
    !name ||
    session_count == null ||
    price_minor == null ||
    !created_at ||
    !updated_at
  ) {
    throw new Error("Remote package definition row is missing required columns");
  }
  return {
    id,
    organization_id,
    app_id,
    name,
    description: asNullableString(row.description),
    included_services: includedServicesFromUnknown(row.included_services),
    session_count,
    price_minor,
    currency: asString(row.currency) || "TWD",
    validity_days: asNumber(row.validity_days),
    is_active: row.is_active !== false,
    created_at,
    updated_at,
  };
}

export function packageDefinitionFromRemoteRow(
  organizationAppId: string,
  row: DbPackageDefinition,
): PackageDefinition {
  return {
    id: row.app_id,
    organizationId: organizationAppId,
    name: row.name,
    description: row.description ?? undefined,
    includedServices: row.included_services,
    sessionCount: row.session_count,
    priceMinor: row.price_minor,
    currency: row.currency,
    validityDays: row.validity_days ?? undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function dbCustomerPackageFromUnknown(
  row: Record<string, unknown>,
): DbCustomerPackage {
  const id = asString(row.id);
  const organization_id = asString(row.organization_id);
  const customer_id = asString(row.customer_id);
  const package_definition_id = asString(row.package_definition_id);
  const app_id = asString(row.app_id);
  const name_snapshot = asString(row.name_snapshot);
  const session_count_snapshot = asNumber(row.session_count_snapshot);
  const price_snapshot_minor = asNumber(row.price_snapshot_minor);
  const purchased_at = asString(row.purchased_at);
  const created_at = asString(row.created_at);
  const updated_at = asString(row.updated_at);
  const status = asString(row.status);
  if (
    !id ||
    !organization_id ||
    !customer_id ||
    !package_definition_id ||
    !app_id ||
    !name_snapshot ||
    session_count_snapshot == null ||
    price_snapshot_minor == null ||
    !purchased_at ||
    !created_at ||
    !updated_at ||
    !status
  ) {
    throw new Error("Remote customer package row is missing required columns");
  }
  return {
    id,
    organization_id,
    customer_id,
    package_definition_id,
    purchase_transaction_id: asNullableString(row.purchase_transaction_id),
    app_id,
    name_snapshot,
    session_count_snapshot,
    price_snapshot_minor,
    included_service_ids_snapshot: Array.isArray(row.included_service_ids_snapshot)
      ? row.included_service_ids_snapshot.filter((value): value is string => typeof value === "string")
      : [],
    purchased_at,
    activated_at: asNullableString(row.activated_at),
    expires_at: asNullableString(row.expires_at),
    status: status as DbCustomerPackage["status"],
    created_at,
    updated_at,
  };
}

export function customerPackageFromRemoteRow(
  organizationAppId: string,
  row: DbCustomerPackage,
  ids: { customerAppId: string; packageDefinitionAppId: string },
): CustomerPackage {
  return {
    id: row.app_id,
    organizationId: organizationAppId,
    customerId: ids.customerAppId,
    packageDefinitionId: ids.packageDefinitionAppId,
    purchaseTransactionId: row.purchase_transaction_id ?? undefined,
    nameSnapshot: row.name_snapshot,
    sessionCountSnapshot: row.session_count_snapshot,
    priceSnapshot: row.price_snapshot_minor,
    includedServiceIdsSnapshot: row.included_service_ids_snapshot,
    purchasedAt: row.purchased_at,
    activatedAt: row.activated_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function dbPackageLedgerFromUnknown(
  row: Record<string, unknown>,
): DbPackageLedgerEntry {
  const id = asString(row.id);
  const organization_id = asString(row.organization_id);
  const customer_package_id = asString(row.customer_package_id);
  const customer_id = asString(row.customer_id);
  const app_id = asString(row.app_id);
  const type = asString(row.type);
  const session_delta = asNumber(row.session_delta);
  const created_by_staff_id = asString(row.created_by_staff_id);
  const created_at = asString(row.created_at);
  if (
    !id ||
    !organization_id ||
    !customer_package_id ||
    !customer_id ||
    !app_id ||
    !type ||
    session_delta == null ||
    !created_by_staff_id ||
    !created_at
  ) {
    throw new Error("Remote package ledger row is missing required columns");
  }
  return {
    id,
    organization_id,
    customer_package_id,
    customer_id,
    app_id,
    type: type as DbPackageLedgerEntry["type"],
    session_delta,
    service_id: asNullableString(row.service_id),
    appointment_id: asNullableString(row.appointment_id),
    treatment_id: asNullableString(row.treatment_id),
    transaction_id: asNullableString(row.transaction_id),
    location_id: asNullableString(row.location_id),
    reason: asNullableString(row.reason),
    effect_key: asNullableString(row.effect_key),
    reverses_entry_id: asNullableString(row.reverses_entry_id),
    created_by_staff_id,
    created_at,
  };
}

export function packageLedgerFromRemoteRow(
  organizationAppId: string,
  row: DbPackageLedgerEntry,
  ids: { customerPackageAppId: string; customerAppId: string; locationAppId?: string },
): PackageLedgerEntry {
  return {
    id: row.app_id,
    organizationId: organizationAppId,
    customerPackageId: ids.customerPackageAppId,
    customerId: ids.customerAppId,
    type: row.type,
    sessionDelta: row.session_delta,
    appointmentId: row.appointment_id ?? undefined,
    treatmentId: row.treatment_id ?? undefined,
    transactionId: row.transaction_id ?? undefined,
    locationId: ids.locationAppId,
    reason: row.reason ?? undefined,
    effectKey: row.effect_key ?? undefined,
    createdByStaffId: row.created_by_staff_id,
    createdAt: row.created_at,
  };
}
