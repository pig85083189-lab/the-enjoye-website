"use client";

import {
  PACKAGE_REMOTE_WRITE_PILOT_ENV,
  runAuthenticatedPackageWriteCreate,
  type PackageRemoteCreateInput,
  type PackageWriteClient,
} from "@/lib/packages/package-remote-write-pilot";
import { PACKAGE_REMOTE_READ_PILOT_ENV } from "@/lib/packages/package-remote-read-flag";
import { emitPackageRemoteWriteRefresh } from "@/lib/packages/package-write-refresh";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

function writeClient(): PackageWriteClient | null {
  return createBrowserClientOrNull() as PackageWriteClient | null;
}

export async function submitPackageRemoteCreate(input: PackageRemoteCreateInput) {
  const client = writeClient();
  if (!client) {
    throw new Error("Authenticated Supabase client is unavailable");
  }
  const created = await runAuthenticatedPackageWriteCreate(client, input, {
    ...process.env,
    [PACKAGE_REMOTE_WRITE_PILOT_ENV]: "1",
    [PACKAGE_REMOTE_READ_PILOT_ENV]: "1",
  });
  emitPackageRemoteWriteRefresh({
    organizationId: created.organizationId,
    packageDefinitionId: created.id,
  });
  return created;
}
