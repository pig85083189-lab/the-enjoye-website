import { classifyProductionStaffAccess } from "@/lib/staff-auth/production-write-access";
import type { InventoryIdentityDirectory } from "@/lib/appointments/local-appointment-inventory";

interface QueryResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

export interface InventoryReadClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): Promise<QueryResult>;
    };
  };
}

export type InventoryDirectoryResult =
  | InventoryIdentityDirectory
  | { remoteCheck: "unavailable"; message: string };

export async function fetchAppointmentInventoryDirectory(
  client: InventoryReadClient,
  organizationAppId: string,
): Promise<InventoryDirectoryResult> {
  try {
    const organizations = await client.from("organizations").select("id, app_id").eq("app_id", organizationAppId);
    if (organizations.error) return unavailable(organizations.error.message);
    const organization = oneAppRow(organizations.data, organizationAppId);
    if (!organization) return unavailable("組織 app_id 無法唯一對應");

    const [locations, customers, services, staff, appointments] = await Promise.all([
      client.from("locations").select("app_id, organization_id").eq("organization_id", organization.id),
      client.from("customers").select("app_id, organization_id").eq("organization_id", organization.id),
      client.from("services").select("app_id, organization_id").eq("organization_id", organization.id),
      client.from("staff_auth_memberships").select("user_id, auth_user_id, role, is_active, organization_id").eq("organization_id", organizationAppId),
      client.from("appointments").select("id, app_id, staff_id, start_at, end_at, status").eq("organization_id", organization.id),
    ]);
    for (const result of [locations, customers, services, staff, appointments]) {
      if (result.error) return unavailable(result.error.message);
    }

    const locationAppIds = uniqueAppIds(locations.data);
    const customerAppIds = uniqueAppIds(customers.data);
    const serviceAppIds = uniqueAppIds(services.data);
    if (!locationAppIds || !customerAppIds || !serviceAppIds) {
      return unavailable("地點、顧客或服務 app_id 重複或缺失");
    }
    const staffRows = staffRecords(staff.data, organizationAppId);
    if (!staffRows) return unavailable("員工身分無法唯一對應");
    const remoteAppointments = remoteRecords(appointments.data);
    if (!remoteAppointments) return unavailable("正式預約 app_id 重複或缺失");

    return {
      remoteCheck: "checked",
      organizationAppId,
      locationAppIds,
      customerAppIds,
      serviceAppIds,
      staff: staffRows,
      remoteAppointments,
    };
  } catch (error: unknown) {
    return unavailable(error instanceof Error ? error.message : "無法讀取正式資料");
  }
}

function unavailable(message: string): InventoryDirectoryResult {
  return { remoteCheck: "unavailable", message };
}

function oneAppRow(rows: unknown[] | null, appId: string): { id: string } | null {
  const matches = (rows ?? []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return row.app_id === appId && typeof row.id === "string" ? [{ id: row.id }] : [];
  });
  return matches.length === 1 ? matches[0]! : null;
}

function uniqueAppIds(rows: unknown[] | null): string[] | null {
  const ids: string[] = [];
  for (const item of rows ?? []) {
    if (!item || typeof item !== "object") return null;
    const appId = (item as Record<string, unknown>).app_id;
    if (typeof appId !== "string" || !appId.trim()) return null;
    ids.push(appId);
  }
  return new Set(ids).size === ids.length ? ids : null;
}

function staffRecords(rows: unknown[] | null, organizationAppId: string): InventoryIdentityDirectory["staff"] | null {
  const records: InventoryIdentityDirectory["staff"][number][] = [];
  const seen = new Set<string>();
  for (const item of rows ?? []) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (row.organization_id !== organizationAppId || row.is_active === false) continue;
    if (typeof row.user_id !== "string" || typeof row.role !== "string") return null;
    if (seen.has(row.user_id)) return null;
    seen.add(row.user_id);
    const authUserId = typeof row.auth_user_id === "string" ? row.auth_user_id : null;
    const record = {
      userId: row.user_id,
      authUserId,
      role: row.role,
      isActive: true,
    };
    records.push({ ...record, access: classifyProductionStaffAccess(record) });
  }
  return records;
}

function remoteRecords(rows: unknown[] | null): InventoryIdentityDirectory["remoteAppointments"] | null {
  const records: InventoryIdentityDirectory["remoteAppointments"][number][] = [];
  const seen = new Set<string>();
  for (const item of rows ?? []) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const appId = typeof row.app_id === "string" ? row.app_id.trim() : "";
    const dbId = typeof row.id === "string" ? row.id : "";
    const id = appId || dbId;
    if (!id || seen.has(id)) return null;
    seen.add(id);
    records.push({
      id,
      staffId: typeof row.staff_id === "string" ? row.staff_id : "",
      startAt: typeof row.start_at === "string" ? row.start_at : "",
      endAt: typeof row.end_at === "string" ? row.end_at : "",
      status: typeof row.status === "string" ? row.status : "",
    });
  }
  return records;
}
