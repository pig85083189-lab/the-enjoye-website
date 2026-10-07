"use client";

import {
  listAuthenticatedOrgStaff,
  runAuthenticatedStaffWriteCreate,
  STAFF_REMOTE_WRITE_PILOT_ENV,
  type StaffWriteClient,
} from "@/lib/staff/staff-remote-write-pilot";
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
  const env = {
    ...process.env,
    [STAFF_REMOTE_WRITE_PILOT_ENV]: "1",
  };
  const created = await runAuthenticatedStaffWriteCreate(client, input, env);
  const roster = await listAuthenticatedOrgStaff(client);
  return { created, roster };
}
