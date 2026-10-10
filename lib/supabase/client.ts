/**
 * Browser Supabase client (Publishable key only).
 * Call from Client Components.
 */
import { createBrowserClient } from "@supabase/ssr";
import {
  STAFF_SUPABASE_COOKIE_ENCODING,
  STAFF_SUPABASE_COOKIE_OPTIONS,
} from "@/lib/supabase/auth-cookie-options";
import { getSupabaseEnv, tryGetSupabaseEnv } from "@/lib/supabase/env";

function browserClient(url: string, publishableKey: string) {
  return createBrowserClient(url, publishableKey, {
    cookieEncoding: STAFF_SUPABASE_COOKIE_ENCODING,
    cookieOptions: STAFF_SUPABASE_COOKIE_OPTIONS,
  });
}

export function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return browserClient(url, publishableKey);
}

export function createBrowserClientOrNull() {
  const env = tryGetSupabaseEnv();
  if (!env) return null;
  return browserClient(env.url, env.publishableKey);
}
