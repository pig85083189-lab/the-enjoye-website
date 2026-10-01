import { createClient } from "@supabase/supabase-js";
import {
  tryGetSupabaseEnv,
  tryGetSupabaseServiceRoleKey,
} from "@/lib/supabase/env";

/**
 * Server-only admin client. Returns null when invite is not configured.
 * Never import this from Client Components.
 */
export function createServiceRoleClient() {
  if (typeof window !== "undefined") {
    throw new Error("Service role client cannot run in the browser");
  }
  const env = tryGetSupabaseEnv();
  const key = tryGetSupabaseServiceRoleKey();
  if (!env || !key) return null;
  return createClient(env.url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
