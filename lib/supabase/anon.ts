import { createClient } from "@supabase/supabase-js";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";

/**
 * Cookie-less publishable-key client for token-gated LINE webhook RPCs.
 * Never uses the service role. Never import from Client Components.
 */
export function createAnonymousClient() {
  if (typeof window !== "undefined") {
    throw new Error("Anonymous server client cannot run in the browser");
  }
  const env = tryGetSupabaseEnv();
  if (!env) return null;
  return createClient(env.url, env.publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
