"use client";

import {
  listAuthenticatedOrgStaff,
  runAuthenticatedStaffWriteCreate,
  type StaffWriteClient,
} from "@/lib/staff/staff-remote-write-pilot";
import { staffRemoteWriteBrowserEnv } from "@/lib/staff/staff-remote-write-flag";
import type { StaffOperationalCreateDraft } from "@/lib/staff/staff-remote-write-command";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

function writeClient(): StaffWriteClient | null {
  return createBrowserClientOrNull() as StaffWriteClient | null;
}

export async function submitStaffOperationalCreate(input: StaffOperationalCreateDraft) {
  const client = writeClient();
  if (!client) {
    throw new Error("Authenticated Supabase client is unavailable");
  }
  const created = await runAuthenticatedStaffWriteCreate(
    client,
    input,
    staffRemoteWriteBrowserEnv(),
  );
  const roster = await listAuthenticatedOrgStaff(client, input.organizationId);
  return { created, roster };
}
