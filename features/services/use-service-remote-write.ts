"use client";

import {
  SERVICE_REMOTE_WRITE_PILOT_ENV,
  runAuthenticatedServiceWriteCreate,
  resolveAuthenticatedServiceManagement,
  type ServiceRemoteCreateInput,
  type ServiceWriteClient,
} from "@/lib/services/service-remote-write-pilot";
import { SERVICE_REMOTE_READ_PILOT_ENV } from "@/lib/services/service-remote-read-flag";
import { emitServiceRemoteWriteRefresh } from "@/lib/services/service-write-refresh";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

function writeClient(): ServiceWriteClient | null {
  return createBrowserClientOrNull() as ServiceWriteClient | null;
}

export async function submitServiceRemoteCreate(input: ServiceRemoteCreateInput) {
  const client = writeClient();
  if (!client) {
    throw new Error("Authenticated Supabase client is unavailable");
  }
  const created = await runAuthenticatedServiceWriteCreate(client, input, {
    ...process.env,
    [SERVICE_REMOTE_WRITE_PILOT_ENV]: "1",
    [SERVICE_REMOTE_READ_PILOT_ENV]: "1",
  });
  emitServiceRemoteWriteRefresh({
    organizationId: created.organizationId,
    serviceId: created.id,
  });
  return created;
}

export async function submitServiceRemoteUpdate(
  organizationId: string,
  serviceId: string,
  staffId: string,
  patch: { name?: string; category?: string | null; durationMinutes?: number; priceMinor?: number; isActive?: boolean },
) {
  const client = createBrowserClientOrNull();
  if (!client) throw new Error("無法連線至資料庫");
  const { identity } = await resolveAuthenticatedServiceManagement(
    client as ServiceWriteClient, organizationId, serviceId, staffId,
    { ...process.env, [SERVICE_REMOTE_WRITE_PILOT_ENV]: "1", [SERVICE_REMOTE_READ_PILOT_ENV]: "1" },
  );
  const values: Record<string, string | number | boolean | null> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error("請輸入服務名稱");
    values.name = patch.name.trim();
  }
  if (patch.category !== undefined) values.category = patch.category?.trim() || null;
  if (patch.durationMinutes !== undefined) {
    if (!Number.isInteger(patch.durationMinutes) || patch.durationMinutes <= 0) throw new Error("服務時長不正確");
    values.duration_minutes = patch.durationMinutes;
  }
  if (patch.priceMinor !== undefined) {
    if (!Number.isSafeInteger(patch.priceMinor) || patch.priceMinor < 0) throw new Error("服務金額不正確");
    values.price_minor = patch.priceMinor;
  }
  if (patch.isActive !== undefined) values.is_active = patch.isActive;
  const { data, error } = await client.from("services").update(values)
    .eq("organization_id", identity.organizationDbId).eq("app_id", serviceId).select("id").single();
  if (error || !data) throw new Error(error?.message || "服務更新失敗");
  emitServiceRemoteWriteRefresh({ organizationId, serviceId });
}
