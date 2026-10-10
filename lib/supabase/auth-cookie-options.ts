/**
 * Shared cookie settings for browser, server, proxy, and Auth callback clients.
 * PKCE code_verifier must land in the same cookie jar the callback reads.
 */
export const STAFF_SUPABASE_COOKIE_ENCODING = "base64url" as const;

export const STAFF_SUPABASE_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax" as const,
};
