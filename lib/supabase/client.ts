/**
 * Browser Supabase client (Publishable key only).
 * Call from Client Components.
 */
import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv, tryGetSupabaseEnv } from "@/lib/supabase/env";

export function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}

export function createBrowserClientOrNull() {
  const env = tryGetSupabaseEnv();
  if (!env) return null;
  return createBrowserClient(env.url, env.publishableKey);
}
