"use client";

import { tryGetSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/client";
import { clearSession } from "@/lib/auth";
import { setStaffAuthUser } from "@/lib/staff-auth/session";

/** Sign out Supabase cookies and drop leftover demo localStorage. */
export async function signOutStaff(): Promise<void> {
  setStaffAuthUser(null);
  clearSession();
  if (!tryGetSupabaseEnv()) return;
  const supabase = createClient();
  await supabase.auth.signOut();
}
