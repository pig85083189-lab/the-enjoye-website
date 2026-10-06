"use client";

import {
  SERVICE_REMOTE_WRITE_PILOT_ENV,
  runAuthenticatedServiceWriteCreate,
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
