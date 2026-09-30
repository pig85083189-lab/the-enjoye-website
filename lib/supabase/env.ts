/**
 * Central env validation for Supabase public clients.
 * Never log or return the actual key values.
 */

export function tryGetSupabaseEnv(): {
  url: string;
  publishableKey: string;
} | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function getSupabaseEnv(): {
  url: string;
  publishableKey: string;
} {
  const env = tryGetSupabaseEnv();
  if (!env) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  return env;
}

/** Server-only. Never expose via NEXT_PUBLIC_. Returns null when invite is not configured. */
export function tryGetSupabaseServiceRoleKey(): string | null {
  if (typeof window !== "undefined") return null;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return null;
  if (key.startsWith("NEXT_PUBLIC_")) return null;
  return key;
}

/** Public bootstrap mapping only — auth user UUID, never a password. */
export function ownerBootstrapAuthUserId(): string | null {
  const id = process.env.NEXT_PUBLIC_BEAUTY_OS_OWNER_AUTH_USER_ID?.trim();
  return id || null;
}

export function isDevDemoAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.BEAUTY_OS_DEV_DEMO_AUTH === "1"
  );
}
