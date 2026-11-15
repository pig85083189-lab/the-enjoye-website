import { createClient } from "@supabase/supabase-js";

/**
 * Financial operations use the dedicated Beauty OS database, not the shared
 * booking/authentication Supabase connection. Server-only; fail closed.
 */
const BEAUTY_OS_URL = "https://bfzquejrtgqzzarhkiya.supabase.co";

export function createBeautyOsFinanceClient() {
  if (typeof window !== "undefined") throw new Error("Finance client is server-only");
  const configuredUrl = process.env.BEAUTY_OS_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = process.env.BEAUTY_OS_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (configuredUrl !== BEAUTY_OS_URL || !secret) {
    console.error("[beauty-os-finance] dedicated_database_config_invalid");
    return null;
  }
  return createClient(configuredUrl, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
